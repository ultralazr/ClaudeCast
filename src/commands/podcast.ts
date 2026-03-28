import { readdirSync, existsSync } from 'fs'
import { join } from 'path'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { getOrCreateWeeklyNotebook, getWeekLabel } from '../nlm/notebook.js'
import { addFileSource } from '../nlm/source.js'
import { createWeeklyPodcast } from '../nlm/podcast.js'
import { loadConfig } from '../utils/config.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const LOGS_DIR = resolve(__dirname, '../../data/logs')

export async function podcastCommand(weekLabel?: string): Promise<void> {
  const config = loadConfig()
  const week = weekLabel ?? getWeekLabel(new Date())

  console.log(`Generating podcast for week: ${week}`)

  // Find the weekly notebook
  const notebookId = await getOrCreateWeeklyNotebook(config.nlmNotebookPrefix, week)
  console.log(`  Using notebook ID: ${notebookId}`)

  // Find all reflection files for this week and add them as sources
  const reflectionFiles = findReflectionFiles(week)
  if (reflectionFiles.length > 0) {
    console.log(`  Adding ${reflectionFiles.length} reflection file(s) as sources...`)
    for (const { filePath, project } of reflectionFiles) {
      await addFileSource(notebookId, filePath, `Reflection: ${project} ${week}`)
    }
  }

  // Generate podcast
  const outputPath = await createWeeklyPodcast(notebookId, week)
  console.log(`\nPodcast saved to: ${outputPath}`)
}

function findReflectionFiles(week: string): Array<{ filePath: string; project: string }> {
  if (!existsSync(LOGS_DIR)) return []

  const results: Array<{ filePath: string; project: string }> = []
  for (const entry of readdirSync(LOGS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const reflectionPath = join(LOGS_DIR, entry.name, `${week}_reflection.md`)
    if (existsSync(reflectionPath)) {
      results.push({ filePath: reflectionPath, project: entry.name })
    }
  }
  return results
}
