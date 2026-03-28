import { ensureAuth } from '../nlm/auth.js'
import { episodePad } from '../utils/episode-windows.js'
import { findAllSessions, loadExcludedPrefixes, isExcluded, readCwdFromJsonl } from '../utils/sessions.js'
import { loadConfig, resolveProjectName } from '../utils/config.js'
import { loadEpisodeState, saveEpisodeState, recordEpisode } from '../storage/episode-state.js'
import { runStage1 } from '../nlm/stage1.js'
import { runStage2 } from '../nlm/stage2.js'

export async function episodeCommand(options: { dryRun?: boolean }): Promise<void> {
  const config = loadConfig()
  const minMinutes = (config as unknown as Record<string, number>)['minSessionMinutes'] ?? 5
  const state = loadEpisodeState()

  console.log('ClaudeCast Episode\n')

  if (!options.dryRun) await ensureAuth()

  // Determine window: lastRunContentEnd → now
  // Fallback: if lastRunContentEnd is unset but episodes exist, use the last episode's windowEnd
  //           to avoid re-processing all history
  const lastEpisode = state.episodes[String(state.lastEpisodeNumber)]
  const rawWindowStart = state.lastRunContentEnd
    ?? (lastEpisode?.windowEnd ?? null)
  const windowStart = rawWindowStart ? new Date(rawWindowStart) : null
  const windowEnd = new Date()

  if (windowStart) {
    console.log(`Processing sessions since: ${windowStart.toISOString()}`)
  } else {
    console.log('No previous run found — processing all closed sessions up to now.')
  }

  const allSessions = findAllSessions(config.claudeDataDir)
  const excludedPrefixes = loadExcludedPrefixes()

  const candidateSessions = allSessions.filter(s => !isExcluded(s.sessionId, excludedPrefixes))

  // Group by project
  const byProject = new Map<string, { slug: string; sessions: typeof allSessions }>()

  for (const s of candidateSessions) {
    const cwd = await readCwdFromJsonl(s.jsonlPath)
    const project = cwd ? resolveProjectName(cwd, config) : s.projectDir
    const slug = project.toLowerCase().replace(/[^a-z0-9]+/g, '-')
    if (!byProject.has(project)) byProject.set(project, { slug, sessions: [] })
    byProject.get(project)!.sessions.push(s)
  }

  const episodeNumber = state.lastEpisodeNumber + 1
  const padded = episodePad(episodeNumber)

  // Stage 1: per-project summaries
  const stage1Results = []
  const projects: string[] = []
  let latestTimestamp: string | null = null

  for (const [project, { slug, sessions }] of byProject) {
    console.log(`\nProject: ${project}`)
    const result = await runStage1(
      episodeNumber,
      padded,
      project,
      slug,
      sessions,
      windowStart ?? new Date(0),
      windowEnd,
      minMinutes,
      options.dryRun ?? false,
    )
    if (result) {
      stage1Results.push(result)
      projects.push(project)
    }
  }

  if (stage1Results.length === 0) {
    console.log('\nNo new content since last run.')
    return
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
  console.log(`\nStage 2: Generating ClaudeCast Episode ${episodeNumber} podcast...`)
  const stage2 = await runStage2(episodeNumber, padded, stage1Results, options.dryRun ?? false)

  // Update state
  const nowStr = new Date().toISOString()
  const updated = recordEpisode({
    number: episodeNumber,
    windowStart: (windowStart ?? new Date(0)).toISOString(),
    windowEnd: windowEnd.toISOString(),
    projects,
    podcastFile: stage2?.podcastFile ?? '[dry-run]',
    tagline: stage2?.tagline ?? '',
    completedAt: nowStr,
    tokenUsage: episodeTokenUsage,
  }, state)

  updated.lastRunContentEnd = windowEnd.toISOString()
  updated.lastRunAt = nowStr

  if (!options.dryRun) saveEpisodeState(updated)

  console.log(`\n✓ Episode ${episodeNumber} complete${stage2?.podcastFile ? ` → ${stage2.podcastFile}` : ''}`)
}
