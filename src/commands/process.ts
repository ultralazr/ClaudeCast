import { input } from '@inquirer/prompts'
import { format } from 'date-fns'
import { findAllSessions, getActiveSessionIds, decodeProjectDir } from '../utils/sessions.js'
import { loadConfig, resolveProjectName } from '../utils/config.js'
import { extractSession } from '../extractor/smart-extract.js'
import { findNewTools, mergeTools } from '../extractor/detect-tools.js'
import { getOrCreateWeeklyNotebook, getWeekLabel } from '../nlm/notebook.js'
import { addTranscriptSource } from '../nlm/source.js'
import { summarizeSession } from '../nlm/summarize.js'
import { writeLogEntry, appendOrCreateReflection } from '../storage/markdown.js'
import {
  loadProcessedSessions,
  saveProcessedSessions,
  markSessionProcessed,
  loadKnownTools,
  saveKnownTools,
} from '../storage/state.js'

interface ProcessedResult {
  project: string
  date: string
  week: string
  summary: string
  oneLiner: string
  logFile: string
}

export async function processCommand(options: { dryRun?: boolean; limit?: number }): Promise<void> {
  const config = loadConfig()
  const processedState = loadProcessedSessions()
  const knownTools = loadKnownTools()

  // 1. Find all session files
  console.log('Scanning Claude sessions...')
  const allSessions = findAllSessions(config.claudeDataDir)
  const activeSessions = await getActiveSessionIds(config.claudeDataDir)

  const pending = allSessions.filter(s => {
    if (processedState.sessions[s.sessionId]) return false // already processed
    if (activeSessions.has(s.sessionId)) return false // still running
    return true
  })

  if (pending.length === 0) {
    console.log('No new sessions to process.')
    return
  }

  const toProcess = options.limit ? pending.slice(0, options.limit) : pending
  console.log(`Found ${pending.length} unprocessed session(s). Processing ${toProcess.length}...\n`)

  const resultsByProject: Record<string, ProcessedResult[]> = {}

  for (const sessionFile of toProcess) {
    console.log(`Processing session: ${sessionFile.sessionId.slice(0, 8)}...`)

    // 2. Extract transcript
    const extracted = await extractSession(sessionFile.jsonlPath)
    if (!extracted) {
      console.log('  Skipping: could not extract session data.')
      continue
    }

    const projectPath = decodeProjectDir(sessionFile.projectDir)
    const project = resolveProjectName(extracted.cwd || projectPath, config)
    const sessionDate = format(new Date(extracted.startTime), 'yyyy-MM-dd')
    const week = getWeekLabel(new Date(extracted.startTime))
    const newTools = findNewTools([...extracted.toolsUsed, ...extracted.mcpsUsed], knownTools)

    console.log(`  Project: ${project} | Date: ${sessionDate} | Week: ${week}`)
    console.log(`  Duration: ${extracted.durationMinutes} min | Tools: ${extracted.toolsUsed.join(', ')}`)
    if (newTools.length > 0) console.log(`  NEW tools/MCPs: ${newTools.join(', ')}`)

    if (options.dryRun) {
      console.log('  [dry-run] Skipping NLM submission\n')
      continue
    }

    // 3. Send to NLM
    console.log('  Sending to NotebookLM...')
    const notebookId = await getOrCreateWeeklyNotebook(config.nlmNotebookPrefix, week)
    const sourceTitle = `Session: ${project} ${sessionDate}`
    await addTranscriptSource(notebookId, sourceTitle, extracted.conversationText)

    // 4. Get summary
    console.log('  Querying NLM for summary...')
    const summary = await summarizeSession(notebookId)

    // Extract a one-liner from the summary (first sentence)
    const oneLiner = summary.split(/[.\n]/)[0]?.trim() ?? summary.slice(0, 100)

    // 5. Update known tools
    const mergedTools = mergeTools(
      [...extracted.toolsUsed, ...extracted.mcpsUsed],
      knownTools,
      sessionDate,
    )
    Object.assign(knownTools, mergedTools)

    const durationStr =
      extracted.durationMinutes >= 60
        ? `${Math.floor(extracted.durationMinutes / 60)}h ${extracted.durationMinutes % 60}m`
        : `${extracted.durationMinutes}m`

    // 6. Save markdown
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
    )
    console.log(`  Saved: ${logFile}\n`)

    // 7. Mark as processed
    const updatedState = markSessionProcessed(extracted.sessionId, {
      processedAt: new Date().toISOString(),
      logFile,
      project,
      week,
    }, processedState)
    Object.assign(processedState, updatedState)

    if (!resultsByProject[project]) resultsByProject[project] = []
    resultsByProject[project].push({ project, date: sessionDate, week, summary, oneLiner, logFile })
  }

  // Save state
  saveProcessedSessions(processedState)
  saveKnownTools(knownTools)

  if (options.dryRun) return

  // 8. Prompt for per-project comments
  const projects = Object.keys(resultsByProject)
  if (projects.length === 0) return

  console.log('\n=== Weekly Reflections ===\n')
  console.log('For each project, you can enter notes/lessons learned for the week.\n')

  for (const project of projects) {
    const results = resultsByProject[project]
    const week = results[0]!.week
    const today = format(new Date(), 'yyyy-MM-dd')

    console.log(`\nProject: ${project} (${week})`)
    console.log('Sessions processed:')
    for (const r of results) {
      console.log(`  ${r.date}: ${r.oneLiner}`)
    }
    console.log()

    const notes = await input({
      message: `Your notes/lessons for ${project} this week (press Enter to skip):`,
    })

    if (notes.trim()) {
      const reflectionFile = appendOrCreateReflection(
        project,
        week,
        today,
        results.map(r => ({ date: r.date, oneLiner: r.oneLiner })),
        notes.trim(),
      )
      console.log(`  Saved reflection: ${reflectionFile}`)
    } else {
      console.log('  (skipped)')
    }
  }

  console.log('\nDone!')
}
