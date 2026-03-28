import { execa } from 'execa'
import { existsSync, mkdirSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PODCASTS_DIR = resolve(__dirname, '../../data/podcasts')

/** Create an audio overview from the weekly notebook */
export async function createWeeklyPodcast(notebookId: string, weekLabel: string): Promise<string> {
  if (!existsSync(PODCASTS_DIR)) mkdirSync(PODCASTS_DIR, { recursive: true })

  console.log('  Requesting audio generation from NLM (this may take a few minutes)...')

  // Create audio artifact via `nlm audio create`
  await execa('nlm', [
    'audio', 'create',
    notebookId,
    '--format', 'deep_dive',
    '--confirm',
  ])

  // Poll studio status until audio is COMPLETE
  // studio status --json returns an array of artifacts: [{type, state, ...}]
  console.log('  Waiting for audio to be ready...')
  let attempts = 0
  while (attempts < 30) {
    await sleep(10000)
    const { stdout } = await execa('nlm', ['studio', 'status', notebookId, '--json'])
    const artifacts = JSON.parse(stdout) as Array<{ type?: string; state?: string; artifact_type?: string }>
    const audio = artifacts.find(a => a.type === 'audio' || a.artifact_type === 'audio')
    if (audio?.state === 'COMPLETE') break
    if (audio?.state === 'FAILED') throw new Error('Audio generation failed')
    attempts++
    console.log(`  Still generating... (${attempts * 10}s)`)
  }

  // Download — NLM saves as .m4a not .mp3
  const outputPath = resolve(PODCASTS_DIR, `${weekLabel}_podcast.m4a`)
  await execa('nlm', ['download', 'audio', notebookId, '--output', outputPath, '--no-progress'])
  return outputPath
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
