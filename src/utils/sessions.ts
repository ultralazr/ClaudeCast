import { readdirSync, readFileSync, existsSync } from 'fs'
import { join, resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { execa } from 'execa'

const __dirname = dirname(fileURLToPath(import.meta.url))
const EXCLUDE_FILE = resolve(__dirname, '../../config/exclude-sessions.txt')

export interface SessionFile {
  sessionId: string
  jsonlPath: string
  projectDir: string // encoded project dir name
}

/** Read all session JSONL files from ~/.claude/projects/ */
export function findAllSessions(claudeDataDir: string): SessionFile[] {
  const projectsDir = join(claudeDataDir, 'projects')
  if (!existsSync(projectsDir)) return []

  const sessions: SessionFile[] = []
  const projectDirs = readdirSync(projectsDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)

  for (const projectDir of projectDirs) {
    const projectPath = join(projectsDir, projectDir)
    const files = readdirSync(projectPath).filter(f => f.endsWith('.jsonl'))
    for (const file of files) {
      sessions.push({
        sessionId: file.replace('.jsonl', ''),
        jsonlPath: join(projectPath, file),
        projectDir,
      })
    }
  }
  return sessions
}

/** Decode the encoded project dir name back to a filesystem path.
 *  Note: this is lossy for paths containing hyphens — prefer readCwdFromJsonl() instead. */
export function decodeProjectDir(encodedDir: string): string {
  return encodedDir.replace(/^([A-Z])--/, '$1:\\').replace(/-/g, '\\')
}

/** Quickly read the cwd field from the first JSONL entry that has one */
export async function readCwdFromJsonl(jsonlPath: string): Promise<string | null> {
  const { createReadStream } = await import('fs')
  const { createInterface } = await import('readline')
  const rl = createInterface({ input: createReadStream(jsonlPath, { encoding: 'utf-8' }), crlfDelay: Infinity })
  for await (const line of rl) {
    try {
      const obj = JSON.parse(line.trim()) as { cwd?: string }
      if (obj.cwd) { rl.close(); return obj.cwd }
    } catch { /* skip */ }
  }
  return null
}

/** Load excluded session ID prefixes from config/exclude-sessions.txt */
export function loadExcludedPrefixes(): string[] {
  if (!existsSync(EXCLUDE_FILE)) return []
  return readFileSync(EXCLUDE_FILE, 'utf-8')
    .split('\n')
    .map(line => line.replace(/#.*/, '').trim())
    .filter(line => line.length > 0)
}

/** Check if a session ID matches any excluded prefix */
export function isExcluded(sessionId: string, prefixes: string[]): boolean {
  return prefixes.some(prefix => sessionId.startsWith(prefix))
}

/** Returns the set of session IDs that are currently active (PID still running) */
export async function getActiveSessionIds(claudeDataDir: string): Promise<Set<string>> {
  const sessionsDir = join(claudeDataDir, 'sessions')
  if (!existsSync(sessionsDir)) return new Set()

  const active = new Set<string>()
  const files = readdirSync(sessionsDir).filter(f => f.endsWith('.json'))

  for (const file of files) {
    try {
      const content = JSON.parse(readFileSync(join(sessionsDir, file), 'utf-8')) as Record<string, unknown>
      // File is named <pid>.json — the PID is the filename
      const pid = file.replace('.json', '')
      const sessionId = (content['sessionId'] as string) || ''
      if (!sessionId) continue

      const isRunning = await isPidRunning(pid)
      if (isRunning) active.add(sessionId)
    } catch {
      // ignore corrupt files
    }
  }
  return active
}

async function isPidRunning(pid: string): Promise<boolean> {
  try {
    // Windows: tasklist; Unix: kill -0
    if (process.platform === 'win32') {
      const { stdout } = await execa('tasklist', ['/FI', `PID eq ${pid}`, '/NH', '/FO', 'CSV'])
      return stdout.includes(`"${pid}"`)
    } else {
      await execa('kill', ['-0', pid])
      return true
    }
  } catch {
    return false
  }
}
