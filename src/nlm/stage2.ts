/**
 * Stage 2: Episode podcast pipeline.
 * Creates a fresh NLM notebook, uploads per-project .md summaries + previous
 * episode recap, triggers audio generation, polls until ready, downloads the
 * .m4a, queries for tagline + recap, then deletes the notebook.
 */
import { execa } from 'execa'
import { readFileSync, existsSync, statSync, mkdirSync, writeFileSync, unlinkSync } from 'fs'
import { join, dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import type { Stage1Result } from './stage1.js'
import { postProcess } from './post-process.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const EPISODES_DIR = resolve(__dirname, '../../data/episodes')
const NLM_SOURCE_HELPER = resolve(__dirname, '../../scripts/nlm_source_add.py')
const NLM_QUERY_HELPER = resolve(__dirname, '../../scripts/nlm_query.py')

const PROMPT_FILE = resolve(__dirname, '../../config/stage2-prompt.txt')

function loadStage2Prompt(agentName: string, humanName: string, city: string, country: string): string {
  const raw = existsSync(PROMPT_FILE)
    ? readFileSync(PROMPT_FILE, 'utf-8').trim()
    : 'Summarize these developer sessions as a podcast episode.'
  return raw
    .replace(/\{agentName\}/g, agentName)
    .replace(/\{humanName\}/g, humanName)
    .replace(/\{city\}/g, city)
    .replace(/\{country\}/g, country)
}

interface ArtifactStatus { type?: string; status?: string; artifact_id?: string }

export interface Stage2Result {
  podcastFile: string
  tagline: string
}

function nlm(...args: string[]): Promise<{ stdout: string; stderr: string }> {
  return execa('nlm', args)
}

async function createNotebook(title: string): Promise<string> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const { stdout } = await nlm('notebook', 'create', title)
      const m = stdout.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
      if (!m) throw new Error(`Could not parse notebook ID from: ${stdout}`)
      return m[0]
    } catch (err) {
      if (attempt < 3) {
        console.log(`  Notebook create failed, retrying in 15s... (attempt ${attempt}/3)`)
        await sleep(15_000)
      } else {
        throw err
      }
    }
  }
  throw new Error('Could not create notebook after 3 attempts')
}

async function deleteNotebook(id: string): Promise<void> {
  try {
    await nlm('notebook', 'delete', id, '--confirm')
  } catch {
    console.warn(`  Warning: could not delete notebook ${id}`)
  }
}

async function uploadTextSource(notebookId: string, text: string, title: string): Promise<void> {
  // Use Python helper directly (nlm CLI source add is broken, Python library works)
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await execa('python', [NLM_SOURCE_HELPER, notebookId, text, title])
      return
    } catch (err) {
      if (attempt < 3) {
        console.log(`  Upload failed, retrying in 15s... (attempt ${attempt}/3)`)
        await sleep(15_000)
      } else {
        throw err
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

export async function runStage2(
  episodeNumber: number,
  episodePadded: string,
  results: Stage1Result[],
  dryRun: boolean,
  agentName = 'Claude',
  humanName = 'User',
  city = 'Vienna',
  country = 'Austria',
): Promise<Stage2Result | null> {
  if (dryRun) {
    console.log(`  [dry-run] Would create podcast notebook "ClaudeCast - Episode ${episodeNumber}"`)
    return null
  }

  const episodeDir = join(EPISODES_DIR, episodePadded)
  if (!existsSync(episodeDir)) mkdirSync(episodeDir, { recursive: true })

  const now = new Date()
  const dd = String(now.getDate()).padStart(2, '0')
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const yyyy = now.getFullYear()
  const projectPart = results.map(r => r.project).join('_')
  const podcastFile = join(episodeDir, `ClaudeCast_ep${episodePadded}_${dd}_${mm}_${yyyy}_${projectPart}.m4a`)
  const rawFile = podcastFile.replace(/\.m4a$/, '_raw.m4a')

  // Skip entirely if post-processed file already exists
  if (existsSync(podcastFile) && statSync(podcastFile).size > 0) {
    console.log(`  Podcast already exists: ${podcastFile}`)
    const tagline = existsSync(join(episodeDir, 'tagline.txt'))
      ? readFileSync(join(episodeDir, 'tagline.txt'), 'utf-8').trim()
      : ''
    return { podcastFile, tagline }
  }

  // Resume from post-processing if raw file already downloaded
  if (existsSync(rawFile) && statSync(rawFile).size > 0) {
    console.log(`  Raw audio exists, resuming post-processing...`)
    await postProcess(rawFile, podcastFile)
    unlinkSync(rawFile)
    return {
      podcastFile,
      tagline: existsSync(join(episodeDir, 'tagline.txt'))
        ? readFileSync(join(episodeDir, 'tagline.txt'), 'utf-8').trim()
        : '',
    }
  }

  const notebookTitle = `ClaudeCast - Episode ${episodeNumber}`
  console.log(`  Creating NLM notebook: "${notebookTitle}"`)
  const notebookId = await createNotebook(notebookTitle)

  // Upload each project summary as a source
  for (const r of results) {
    if (!existsSync(r.mdFile)) continue
    const content = readFileSync(r.mdFile, 'utf-8')
    const title = `${r.project} Summary (${r.sessionCount} sessions, ${r.totalMinutes}min)`
    console.log(`  Uploading: ${title}`)
    await uploadTextSource(notebookId, content, title)
  }

  // Upload previous episode recap if it exists
  const prevPadded = String(episodeNumber - 1).padStart(2, '0')
  const prevRecapFile = join(EPISODES_DIR, prevPadded, 'recap.md')
  if (episodeNumber > 1 && existsSync(prevRecapFile)) {
    console.log(`  Uploading: Episode ${episodeNumber - 1} Recap`)
    await uploadTextSource(notebookId, readFileSync(prevRecapFile, 'utf-8'), `Episode ${episodeNumber - 1} Recap`)
  }

  // Readiness probe: query NLM to confirm sources are indexed before triggering audio
  console.log('  Probing NLM readiness (query)...')
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      await nlm('notebook', 'query', notebookId, 'What projects are covered in these summaries?')
      console.log('  NLM is ready.')
      break
    } catch {
      if (attempt < 5) {
        console.log(`  Not ready yet, waiting 30s... (attempt ${attempt}/5)`)
        await sleep(30_000)
      } else {
        throw new Error('NLM not ready after 5 attempts — sources may not have indexed')
      }
    }
  }

  // Generate audio (retry up to 3 times on rejection)
  console.log('  Generating audio (deep_dive, default length)...')
  let audioCreated = false
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await nlm('audio', 'create', notebookId, '--format', 'deep_dive', '--length', 'default', '--focus', loadStage2Prompt(agentName, humanName, city, country), '--confirm')
      audioCreated = true
      break
    } catch (err) {
      const msg = String(err)
      if (attempt < 3 && (msg.includes('rejected') || msg.includes('Try again'))) {
        console.log(`  Audio creation attempt ${attempt} failed, retrying in 30s...`)
        await sleep(30_000)
      } else {
        throw err
      }
    }
  }
  if (!audioCreated) throw new Error('Audio creation failed after 3 attempts')

  // While audio generates, query for tagline and recap
  let tagline = ''
  try {
    console.log('  Querying for episode tagline...')
    const { stdout: taglineOut } = await execa('python', [NLM_QUERY_HELPER, notebookId,
      'Give me a tagline for this episode in 10 words or fewer. Respond with just the tagline, no extra text.'])
    tagline = taglineOut.trim().replace(/^["']|["']$/g, '')
    writeFileSync(join(episodeDir, 'tagline.txt'), tagline, 'utf-8')
    console.log(`  Tagline: ${tagline}`)
  } catch {
    console.warn('  Warning: could not generate tagline')
  }

  try {
    console.log('  Querying for next episode recap...')
    const { stdout: recapOut } = await execa('python', [NLM_QUERY_HELPER, notebookId,
      'Write a short paragraph (3-5 sentences) summarizing this episode. It will be read as a brief recap at the start of the next episode.'])
    writeFileSync(join(episodeDir, 'recap.md'), recapOut.trim(), 'utf-8')
    console.log('  Saved recap.md')
  } catch {
    console.warn('  Warning: could not generate recap')
  }

  // Poll until complete — first check after 60s, then every 60s
  const POLL_INTERVAL_MS = 60_000
  const maxAttempts = 30 // 30 minutes max
  await sleep(POLL_INTERVAL_MS)
  let attempts = 0
  while (attempts < maxAttempts) {
    let stdout: string
    try {
      ;({ stdout } = await nlm('studio', 'status', notebookId, '--json'))
    } catch (err) {
      const msg = String(err)
      if (msg.includes('502') || msg.includes('503') || msg.includes('timeout')) {
        console.log('  Status check failed (transient), retrying...')
        await sleep(POLL_INTERVAL_MS)
        continue
      }
      throw err
    }
    const parsed = JSON.parse(stdout) as { artifacts?: ArtifactStatus[] } | ArtifactStatus[]
    const artifacts: ArtifactStatus[] = Array.isArray(parsed) ? parsed : (parsed.artifacts ?? [])
    const audio = artifacts.find(a => a.type === 'audio')
    if (audio?.status === 'completed') break
    if (audio?.status === 'failed') throw new Error('Audio generation failed')
    // 'unknown' can appear when NLM finishes but returns an unmapped status code.
    // Attempt download optimistically; if it fails, keep polling.
    if (audio?.status === 'unknown') {
      console.log('  Status unknown — attempting download optimistically...')
      try {
        await execa('nlm', ['download', 'audio', notebookId, '--output', rawFile, '--no-progress'])
        if (existsSync(rawFile) && statSync(rawFile).size > 0) break
      } catch { /* not ready yet, keep polling */ }
    }
    attempts++
    console.log(`  Still generating... (${(attempts + 1) * 60}s elapsed)`)
    await sleep(POLL_INTERVAL_MS)
  }
  if (attempts >= maxAttempts) throw new Error(`Audio generation timed out — notebook ${notebookId} left intact for manual recovery`)

  // Download raw audio
  if (!existsSync(rawFile) || statSync(rawFile).size === 0) {
    console.log(`  Downloading...`)
    await execa('nlm', ['download', 'audio', notebookId, '--output', rawFile, '--no-progress'])
  }

  if (!existsSync(rawFile) || statSync(rawFile).size === 0) {
    throw new Error(`Download failed or empty file: ${rawFile}`)
  }

  const sizeMb = (statSync(rawFile).size / 1024 / 1024).toFixed(1)
  console.log(`  Downloaded: ${rawFile.split(/[\\/]/).pop()} (${sizeMb} MB)`)

  // Only delete notebook after successful download
  console.log(`  Deleting notebook ${notebookId}`)
  await deleteNotebook(notebookId)

  // Post-process: add music intro/outro, talker overlay, mono, compress
  await postProcess(rawFile, podcastFile)
  unlinkSync(rawFile)

  return { podcastFile, tagline }
}
