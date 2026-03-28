#!/usr/bin/env node
import { Command } from 'commander'
import { initCommand } from './commands/init.js'
import { addProject, listProjects, setPrefix, setPublisherConfig } from './commands/config.js'
import { processCommand } from './commands/process.js'
import { podcastCommand } from './commands/podcast.js'
import { viewLogs } from './commands/view.js'
import { backfillCommand } from './commands/backfill.js'
import { episodeCommand } from './commands/episode.js'
import { publishCommand } from './commands/publish.js'

const program = new Command()

program
  .name('devlog')
  .description('Automated dev log builder for Claude Code sessions')
  .version('0.1.0')

// ── init ─────────────────────────────────────────────────────────────────────
program
  .command('init')
  .description('Interactive setup wizard — creates config files for a new installation')
  .action(async () => {
    await initCommand()
  })

// ── process ──────────────────────────────────────────────────────────────────
program
  .command('process')
  .description('Find and process unprocessed Claude sessions → NLM summary → markdown log')
  .option('--dry-run', 'Parse and extract sessions without sending to NLM', false)
  .option('--limit <n>', 'Process at most N sessions', (v) => parseInt(v, 10))
  .action(async (opts: { dryRun: boolean; limit?: number }) => {
    await processCommand({ dryRun: opts.dryRun, limit: opts.limit })
  })

// ── podcast ───────────────────────────────────────────────────────────────────
program
  .command('podcast [week]')
  .description('Generate weekly podcast from NLM notebook (e.g. devlog podcast 2026-W13)')
  .action(async (week?: string) => {
    await podcastCommand(week)
  })

// ── view ──────────────────────────────────────────────────────────────────────
program
  .command('view [project]')
  .description('View log entries, optionally filtered by project')
  .option('--week <label>', 'Filter by ISO week (e.g. 2026-W13)')
  .action((project?: string, opts?: { week?: string }) => {
    viewLogs(project, opts?.week)
  })

// ── config ────────────────────────────────────────────────────────────────────
const configCmd = program.command('config').description('Manage devlog configuration')

configCmd
  .command('add-project <path> <name>')
  .description('Map a project cwd path to a friendly name')
  .action((cwdPath: string, name: string) => {
    addProject(cwdPath, name)
  })

configCmd
  .command('list-projects')
  .description('List all configured project mappings')
  .action(() => {
    listProjects()
  })

configCmd
  .command('set-prefix <prefix>')
  .description('Set NLM notebook prefix (default: "Dev Log")')
  .action((prefix: string) => {
    setPrefix(prefix)
  })

configCmd
  .command('set-publisher')
  .description('Configure Cloudflare Worker URL and R2 bucket for podcast publishing')
  .action(async () => {
    await setPublisherConfig()
  })

// ── backfill ──────────────────────────────────────────────────────────────────
program
  .command('backfill')
  .description('Process all historical episodes (one-time) → summaries + ClaudeCast podcast per episode')
  .option('--dry-run', 'Extract and show session info without calling NLM', false)
  .option('--limit <n>', 'Process at most N episodes', (v) => parseInt(v, 10))
  .action(async (opts: { dryRun: boolean; limit?: number }) => {
    await backfillCommand({ dryRun: opts.dryRun, limit: opts.limit })
  })

// ── episode ───────────────────────────────────────────────────────────────────
program
  .command('episode')
  .description('Process the current episode (since last run) → summaries + ClaudeCast podcast')
  .option('--dry-run', 'Extract and show session info without calling NLM', false)
  .action(async (opts: { dryRun: boolean }) => {
    await episodeCommand({ dryRun: opts.dryRun })
  })

// ── publish ───────────────────────────────────────────────────────────────────
program
  .command('publish')
  .description('Upload new episodes to Cloudflare R2 and regenerate the RSS feed')
  .option('--force', 'Re-upload all episodes, even already-published ones', false)
  .option('--dry-run', 'Show what would be uploaded without making changes', false)
  .action(async (opts: { force: boolean; dryRun: boolean }) => {
    await publishCommand({ force: opts.force, dryRun: opts.dryRun })
  })

program.parse(process.argv)
