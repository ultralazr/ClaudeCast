import { format } from 'date-fns'
import { ensureAuth } from '../nlm/auth.js'
import { computeEpisodeWindows, episodePad } from '../utils/episode-windows.js'
import { findAllSessions, loadExcludedPrefixes, isExcluded, readCwdFromJsonl } from '../utils/sessions.js'
import { loadConfig, resolveProjectName } from '../utils/config.js'
import { loadEpisodeState, saveEpisodeState, isEpisodeComplete, recordEpisode } from '../storage/episode-state.js'
import { runStage1 } from '../nlm/stage1.js'
import { runStage2 } from '../nlm/stage2.js'

export async function backfillCommand(options: { dryRun?: boolean; limit?: number }): Promise<void> {
  const config = loadConfig()
  const minMinutes = (config as unknown as Record<string, number>)['minSessionMinutes'] ?? 5

  console.log('ClaudeCast Backfill\n')

  if (!options.dryRun) await ensureAuth()

  // Find oldest session timestamp
  const allSessions = findAllSessions(config.claudeDataDir)
  if (allSessions.length === 0) {
    console.log('No sessions found.')
    return
  }

  // Get oldest timestamp by reading first entry of each file
  let oldestUtc: Date | null = null
  for (const s of allSessions) {
    try {
      const { createReadStream } = await import('fs')
      const { createInterface } = await import('readline')
      const rl = createInterface({ input: createReadStream(s.jsonlPath), crlfDelay: Infinity })
      for await (const line of rl) {
        const obj = JSON.parse(line) as { timestamp?: string }
        if (obj.timestamp) {
          const d = new Date(obj.timestamp)
          if (!oldestUtc || d < oldestUtc) oldestUtc = d
          break
        }
      }
      rl.close()
    } catch { /* skip */ }
  }

  if (!oldestUtc) {
    console.log('Could not determine oldest session timestamp.')
    return
  }

  const episodes = computeEpisodeWindows(oldestUtc)
  const state = loadEpisodeState()
  const excludedPrefixes = loadExcludedPrefixes()

  const toProcess = options.limit ? episodes.slice(0, options.limit) : episodes
  console.log(`Found ${episodes.length} historical episode(s). Processing ${toProcess.length}...\n`)

  for (const ep of toProcess) {
    if (isEpisodeComplete(ep.number, state)) {
      console.log(`Episode ${ep.number}: already complete, skipping.`)
      continue
    }

    console.log(`\n── ${ep.label} ──`)

    // Find sessions with content in this window
    const sessionsInWindow = allSessions.filter(s => !isExcluded(s.sessionId, excludedPrefixes))

    // Group by project
    const byProject = new Map<string, { slug: string; sessions: typeof allSessions }>()

    for (const s of sessionsInWindow) {
      const cwd = await readCwdFromJsonl(s.jsonlPath)
      const project = cwd ? resolveProjectName(cwd, config) : s.projectDir
      const slug = project.toLowerCase().replace(/[^a-z0-9]+/g, '-')
      if (!byProject.has(project)) byProject.set(project, { slug, sessions: [] })
      byProject.get(project)!.sessions.push(s)
    }

    if (byProject.size === 0) {
      console.log('  No sessions in this window, skipping.')
      continue
    }

    // Stage 1: per-project summaries
    const stage1Results = []
    const projects: string[] = []

    for (const [project, { slug, sessions }] of byProject) {
      const result = await runStage1(
        ep.number,
        episodePad(ep.number),
        project,
        slug,
        sessions,
        ep.windowStart,
        ep.windowEnd,
        minMinutes,
        options.dryRun ?? false,
      )
      if (result) {
        stage1Results.push(result)
        projects.push(project)
      }
    }

    if (stage1Results.length === 0) {
      console.log(`\n  No qualifying sessions in Episode ${ep.number}, skipping.`)
      continue
    }

    const episodeTokenUsage = stage1Results.reduce(
      (acc, r) => ({
        inputTokens: acc.inputTokens + r.tokenUsage.inputTokens,
        cacheCreationTokens: acc.cacheCreationTokens + r.tokenUsage.cacheCreationTokens,
        cacheReadTokens: acc.cacheReadTokens + r.tokenUsage.cacheReadTokens,
        outputTokens: acc.outputTokens + r.tokenUsage.outputTokens,
      }),
      { inputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, outputTokens: 0 },
    )

    // Stage 2: podcast
    console.log(`\n  Stage 2: Generating ClaudeCast Episode ${ep.number} podcast...`)
    const stage2 = await runStage2(
      ep.number,
      episodePad(ep.number),
      stage1Results,
      options.dryRun ?? false,
    )

    // Save state
    const nowStr = new Date().toISOString()
    const updated = recordEpisode({
      number: ep.number,
      windowStart: ep.windowStart.toISOString(),
      windowEnd: ep.windowEnd.toISOString(),
      projects,
      podcastFile: stage2?.podcastFile ?? '[dry-run]',
      tagline: stage2?.tagline ?? '',
      completedAt: nowStr,
      tokenUsage: episodeTokenUsage,
    }, state)
    Object.assign(state, updated)
    if (!options.dryRun) saveEpisodeState(state)

    console.log(`\n  ✓ Episode ${ep.number} complete${stage2?.podcastFile ? ` → ${stage2.podcastFile}` : ''}`)
  }

  console.log('\nBackfill complete.')
}
