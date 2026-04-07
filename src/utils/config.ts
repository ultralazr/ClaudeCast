import { readFileSync, writeFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CONFIG_PATH = resolve(__dirname, '../../config/projects.json')

export interface ProjectConfig {
  projectMappings: Record<string, string>
  claudeDataDir: string
  nlmNotebookPrefix: string
  agentName: string
  humanName: string
  city: string
  country: string
}

export function loadConfig(): ProjectConfig {
  if (!existsSync(CONFIG_PATH)) {
    const defaults: ProjectConfig = {
      projectMappings: {},
      claudeDataDir: process.env['USERPROFILE']
        ? `${process.env['USERPROFILE']}\\.claude`
        : `${process.env['HOME']}/.claude`,
      nlmNotebookPrefix: 'Dev Log',
      agentName: 'Claude',
      humanName: 'User',
      city: 'Vienna',
      country: 'Austria',
    }
    saveConfig(defaults)
    return defaults
  }
  const cfg = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) as ProjectConfig
  // Back-fill defaults for fields added after initial setup
  if (!cfg.agentName) cfg.agentName = 'Claude'
  if (!cfg.humanName) cfg.humanName = 'User'
  if (!cfg.city) cfg.city = 'Vienna'
  if (!cfg.country) cfg.country = 'Austria'
  return cfg
}

export function saveConfig(config: ProjectConfig): void {
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8')
}

export function resolveProjectName(cwd: string, config: ProjectConfig): string {
  // Normalize: backslashes + lowercase for case-insensitive Windows path matching
  const normalize = (p: string) => p.replace(/\//g, '\\').toLowerCase()
  const normalizedCwd = normalize(cwd)

  for (const [path, name] of Object.entries(config.projectMappings)) {
    if (typeof name !== 'string') continue // skip non-string values (e.g. minSessionMinutes)
    const normalizedPath = normalize(path)
    if (normalizedCwd === normalizedPath || normalizedCwd.startsWith(normalizedPath + '\\')) {
      return name
    }
  }
  // Fallback: last segment of cwd
  const parts = normalizedCwd.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || 'unknown'
}
