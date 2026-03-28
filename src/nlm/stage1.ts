/**
 * Stage 1: Per-project summary pipeline.
 * Creates a temporary NLM notebook, uploads session transcripts as sources,
 * queries for a structured summary, saves it as a .md file, then deletes the notebook.
 */
import { execa } from 'execa'
import { writeFileSync, existsSync, mkdirSync, rmSync } from 'fs'
import { join, dirname } from 'path'
import { resolve } from 'path'
import { fileURLToPath } from 'url'
import { tmpdir } from 'os'
import { randomBytes } from 'crypto'
import { extractSession, type ExtractOptions } from '../extractor/smart-extract.js'
import type { TokenUsage } from '../extractor/parse-jsonl.js'
import type { SessionFile } from '../utils/sessions.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const EPISODES_DIR = resolve(__dirname, '../../data/episodes')
const NLM_SOURCE_HELPER = resolve(__dirname, '../../scripts/nlm_source_add.py')
const NLM_QUERY_HELPER = resolve(__dirname, '../../scripts/nlm_query.py')

const STAGE1_PROMPT = `Summarize this week's Claude Code sessions for the project.
Cover:
1. What was built or changed
2. Key decisions made and why
3. Problems encountered and how they were resolved
4. Lessons learned and insights

Write concisely in past tense. Scale length to content:
a brief session gets a paragraph, a heavy week gets a full page.
Refer to the AI assistant as "Claude". Refer to the project lead as "Ultralaser".`

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
        console.log(`    Notebook create failed, retrying in 15s... (attempt ${attempt}/3)`)
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

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function uploadTextSource(notebookId: string, text: string, title: string): Promise<void> {
  // Write to temp file to avoid Windows command-line length limits
  const tempFile = join(tmpdir(), `nlm-source-${randomBytes(8).toString('hex')}.txt`)
  writeFileSync(tempFile, text, 'utf-8')

  try {
    // Use Python helper directly (nlm CLI source add is broken, Python library works)
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await execa('python', [NLM_SOURCE_HELPER, notebookId, tempFile, title])
        return
      } catch (err) {
        if (attempt < 3) {
          console.log(`    Upload failed, retrying in 15s... (attempt ${attempt}/3)`)
          await sleep(15_000)
        } else {
          throw err
        }
      }
    }
  } finally {
    try { rmSync(tempFile) } catch { /* ignore */ }
  }
}

async function queryNotebook(notebookId: string): Promise<string> {
  const tempFile = join(tmpdir(), `nlm-query-${randomBytes(8).toString('hex')}.txt`)
  writeFileSync(tempFile, STAGE1_PROMPT, 'utf-8')

  try {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const { stdout } = await execa('python', [NLM_QUERY_HELPER, notebookId, tempFile])
        return stdout.trim()
      } catch (err) {
        if (attempt < 3) {
          console.log(`    Query failed, retrying in 30s... (attempt ${attempt}/3)`)
          await sleep(30_000)
        } else {
          throw err
        }
      }
    }
  } finally {
    try { rmSync(tempFile) } catch { /* ignore */ }
  }
  throw new Error('Query failed after 3 attempts')
}

export interface Stage1Result {
  project: string
  mdFile: string
  sessionCount: number
  totalMinutes: number
  tokenUsage: TokenUsage
}

export async function runStage1(
  episodeNumber: number,
  episodePadded: string,
  project: string,
  projectSlug: string,
  sessions: SessionFile[],
  windowStart: Date,
  windowEnd: Date,
  minMinutes: number,
  dryRun: boolean,
): Promise<Stage1Result | null> {
  const opts: ExtractOptions = { windowStart, windowEnd }
  const extracted = []

  for (const s of sessions) {
    const e = await extractSession(s.jsonlPath, opts)
    if (!e) continue
    if (e.durationMinutes < minMinutes) {
      console.log(`    Skipping session ${s.sessionId.slice(0, 8)} (${e.durationMinutes}min < ${minMinutes}min minimum)`)
      continue
    }
    extracted.push(e)
  }

  if (extracted.length === 0) return null

  const totalMinutes = extracted.reduce((sum, e) => sum + e.durationMinutes, 0)
  const tokenUsage: TokenUsage = extracted.reduce(
    (acc, e) => ({
      inputTokens: acc.inputTokens + e.tokenUsage.inputTokens,
      cacheCreationTokens: acc.cacheCreationTokens + e.tokenUsage.cacheCreationTokens,
      cacheReadTokens: acc.cacheReadTokens + e.tokenUsage.cacheReadTokens,
      outputTokens: acc.outputTokens + e.tokenUsage.outputTokens,
    }),
    { inputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, outputTokens: 0 },
  )
  console.log(`\n  Project: ${project} — ${extracted.length} session(s), ${totalMinutes} min total`)

  if (dryRun) {
    return { project, mdFile: '[dry-run]', sessionCount: extracted.length, totalMinutes, tokenUsage }
  }

  const episodeDir = join(EPISODES_DIR, episodePadded)
  if (!existsSync(episodeDir)) mkdirSync(episodeDir, { recursive: true })

  // Skip if summary already exists
  const mdFileEarly = join(episodeDir, `${projectSlug}.md`)
  if (existsSync(mdFileEarly)) {
    console.log(`    Summary already exists, skipping NLM: ${mdFileEarly}`)
    return { project, mdFile: mdFileEarly, sessionCount: extracted.length, totalMinutes, tokenUsage }
  }

  const notebookTitle = `[TEMP] ClaudeCast Ep${episodeNumber} - ${projectSlug}`
  console.log(`    Creating NLM notebook: "${notebookTitle}"`)
  const notebookId = await createNotebook(notebookTitle)

  try {
    for (const e of extracted) {
      const sessionDate = e.startTime.slice(0, 10)
      const title = `Session ${sessionDate} (${e.durationMinutes}min)`
      console.log(`    Uploading: ${title}`)
      await uploadTextSource(notebookId, e.conversationText, title)
    }

    console.log(`    Querying NLM for ${project} summary...`)
    const summary = await queryNotebook(notebookId)

    const mdFile = join(episodeDir, `${projectSlug}.md`)
    const totalTokens = tokenUsage.inputTokens + tokenUsage.cacheCreationTokens + tokenUsage.outputTokens
    const header = [
      `# ${project} — Episode ${episodeNumber}`,
      ``,
      `**Period:** ${windowStart.toISOString().slice(0, 10)} – ${windowEnd.toISOString().slice(0, 10)}`,
      `**Sessions:** ${extracted.length}`,
      `**Total duration:** ${totalMinutes} min`,
      `**Tokens:** ${totalTokens.toLocaleString()} (in: ${tokenUsage.inputTokens.toLocaleString()}, cache_create: ${tokenUsage.cacheCreationTokens.toLocaleString()}, cache_read: ${tokenUsage.cacheReadTokens.toLocaleString()}, out: ${tokenUsage.outputTokens.toLocaleString()})`,
      ``,
      `---`,
      ``,
    ].join('\n')
    writeFileSync(mdFile, header + summary, 'utf-8')
    console.log(`    Saved: ${mdFile}`)

    return { project, mdFile, sessionCount: extracted.length, totalMinutes, tokenUsage }
  } finally {
    console.log(`    Deleting temp notebook ${notebookId}`)
    await deleteNotebook(notebookId)
  }
}
