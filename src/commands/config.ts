import { readFileSync, writeFileSync, existsSync } from 'fs'
import { input } from '@inquirer/prompts'
import { loadConfig, saveConfig } from '../utils/config.js'
import { configPath } from '../publisher/config.js'

export function addProject(cwdPath: string, friendlyName: string): void {
  const config = loadConfig()
  // Normalize to Windows-style backslash
  const normalized = cwdPath.replace(/\//g, '\\')
  config.projectMappings[normalized] = friendlyName
  saveConfig(config)
  console.log(`Added: "${normalized}" → "${friendlyName}"`)
}

export function listProjects(): void {
  const config = loadConfig()
  const entries = Object.entries(config.projectMappings)
  if (entries.length === 0) {
    console.log('No project mappings configured. Use: devlog config add-project <path> <name>')
    return
  }
  console.log('\nProject mappings:')
  for (const [path, name] of entries) {
    console.log(`  ${name.padEnd(20)} → ${path}`)
  }
}

export function setPrefix(prefix: string): void {
  const config = loadConfig()
  config.nlmNotebookPrefix = prefix
  saveConfig(config)
  console.log(`NLM notebook prefix set to: "${prefix}"`)
}

export async function setPublisherConfig(): Promise<void> {
  const cfgPath = configPath()
  let existing: Record<string, unknown> = {}
  if (existsSync(cfgPath)) {
    existing = JSON.parse(readFileSync(cfgPath, 'utf-8'))
  }
  const prev = (existing as { workerUrl?: string; bucketName?: string; podcast?: { title?: string; description?: string; author?: string; language?: string } })

  const workerUrl = await input({
    message: 'Worker URL (from wrangler deploy output):',
    default: prev.workerUrl ?? '',
  })
  const bucketName = await input({
    message: 'R2 bucket name:',
    default: prev.bucketName ?? 'podcast-files',
  })
  const title = await input({
    message: 'Podcast title:',
    default: prev.podcast?.title ?? 'ClaudeCast',
  })
  const description = await input({
    message: 'Podcast description:',
    default: prev.podcast?.description ?? 'A private AI-generated podcast of weekly Claude Code sessions.',
  })
  const author = await input({
    message: 'Author name:',
    default: prev.podcast?.author ?? '',
  })

  const cfg = {
    workerUrl: workerUrl.trim(),
    bucketName: bucketName.trim(),
    podcast: {
      title: title.trim(),
      description: description.trim(),
      author: author.trim(),
      language: prev.podcast?.language ?? 'en-us',
    },
  }

  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf-8')
  console.log(`\nPublisher config saved to: ${cfgPath}`)
  console.log(`Feed URL will be: ${cfg.workerUrl}/feed.xml`)
}
