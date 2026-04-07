import { readdirSync, statSync } from 'fs'
import { join, basename } from 'path'
import { format } from 'date-fns'
import { extractSession } from '../extractor/smart-extract.js'
import { loadConfig, resolveProjectName } from '../utils/config.js'
import { getOrCreateWeeklyNotebook, getWeekLabel } from '../nlm/notebook.js'
import { addTranscriptSource } from '../nlm/source.js'
import { summarizeSession } from '../nlm/summarize.js'
import { writeLogEntry } from '../storage/markdown.js'
import { findNewTools, mergeTools } from '../extractor/detect-tools.js'
import {
  loadProcessedSessions,
  saveProcessedSessions,
  markSessionProcessed,
  loadKnownTools,
  saveKnownTools,
} from '../storage/state.js'

/** Parse the ISO-ish timestamp embedded in a PI filename.
 *  Format: 2026-04-06T13-09-22-486Z_<uuid>.jsonl */
function parsePiFilenameDate(filename: string): Date | null {
  const m = filename.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/)
  if (!m) return null
  return new Date(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`)
}

function collectFiles(inputPath: string, from?: Date, to?: Date): string[] {
  const stat = statSync(inputPath)
  if (!stat.isDirectory()) return [inputPath]

  return readdirSync(inputPath)
    .filter(f => f.endsWith('.jsonl'))
    .filter(f => {
      if (!from && !to) return true
      const date = parsePiFilenameDate(f)
      if (!date) return true // unknown date — include
      if (from && date < from) return false
      if (to && date >= to) return false
      return true
    })
    .sort()
    .map(f => join(inputPath, f))
}

export async function ingestCommand(options: {
  path: string
  from?: string
  to?: string
  dryRun?: boolean
  agentName?: string
  humanName?: string
  outputDir?: string
}): Promise<void> {
  const config = loadConfig()
  const processedState = loadProcessedSessions()
  const knownTools = loadKnownTools()

  const agentName = options.agentName ?? config.agentName
  const humanName = options.humanName ?? config.humanName
  const fromDate = options.from ? new Date(options.from) : undefined
  const toDate = options.to ? new Date(options.to) : undefined

  const files = collectFiles(options.path, fromDate, toDate)
  if (files.length === 0) {
    console.log('No files found matching the criteria.')
    return
  }

  console.log(`Found ${files.length} file(s) to process.\n`)

  for (const filePath of files) {
    console.log(`Processing: ${basename(filePath)}`)

    const extracted = await extractSession(filePath, { skipRedact: true, agentName, humanName })
    if (!extracted) {
      console.log('  Skipping: could not extract session data.\n')
      continue
    }

    if (processedState.sessions[extracted.sessionId]) {
      console.log('  Skipping: already processed.\n')
      continue
    }

    const project = resolveProjectName(extracted.cwd, config)
    const sessionDate = format(new Date(extracted.startTime), 'yyyy-MM-dd')
    const week = getWeekLabel(new Date(extracted.startTime))
    const newTools = findNewTools([...extracted.toolsUsed, ...extracted.mcpsUsed], knownTools)

    const durationStr = extracted.durationMinutes >= 60
      ? `${Math.floor(extracted.durationMinutes / 60)}h ${extracted.durationMinutes % 60}m`
      : `${extracted.durationMinutes}m`

    console.log(`  Project: ${project} | Date: ${sessionDate} | Week: ${week}`)
    console.log(`  Duration: ${durationStr} | Tools: ${extracted.toolsUsed.join(', ') || 'none'}`)
    if (newTools.length > 0) console.log(`  NEW tools: ${newTools.join(', ')}`)

    if (options.dryRun) {
      console.log('  [dry-run] Skipping NLM submission\n')
      continue
    }

    console.log('  Sending to NotebookLM...')
    const notebookId = await getOrCreateWeeklyNotebook(config.nlmNotebookPrefix, week)
    await addTranscriptSource(notebookId, `Session: ${project} ${sessionDate}`, extracted.conversationText)

    console.log('  Querying NLM for summary...')
    const summary = await summarizeSession(notebookId, agentName)

    const mergedTools = mergeTools(
      [...extracted.toolsUsed, ...extracted.mcpsUsed],
      knownTools,
      sessionDate,
    )
    Object.assign(knownTools, mergedTools)

    const logFile = writeLogEntry(
      project,
      sessionDate,
      extracted.sessionId,
      {
        date: sessionDate,
        project,
        projectPath: extracted.cwd,
        sessionId: extracted.sessionId,
        duration: durationStr,
        toolsUsed: extracted.toolsUsed,
        newTools,
        mcpsUsed: extracted.mcpsUsed,
        skillsUsed: extracted.skillsUsed,
        week,
      },
      summary,
      newTools,
      extracted.mcpsUsed,
      extracted.skillsUsed,
      options.outputDir,
    )
    console.log(`  Saved: ${logFile}\n`)

    const updatedState = markSessionProcessed(extracted.sessionId, {
      processedAt: new Date().toISOString(),
      logFile,
      project,
      week,
    }, processedState)
    Object.assign(processedState, updatedState)
  }

  saveProcessedSessions(processedState)
  saveKnownTools(knownTools)

  console.log('Done!')
}
