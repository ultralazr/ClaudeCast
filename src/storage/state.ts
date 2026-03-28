import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import { resolve } from 'path'
import { fileURLToPath } from 'url'
import type { KnownTools } from '../extractor/detect-tools.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const STATE_DIR = resolve(__dirname, '../../data/state')
const PROCESSED_PATH = `${STATE_DIR}/processed-sessions.json`
const KNOWN_TOOLS_PATH = `${STATE_DIR}/known-tools.json`

export interface ProcessedEntry {
  processedAt: string
  logFile: string
  project: string
  week: string
}

export interface ProcessedSessions {
  sessions: Record<string, ProcessedEntry>
}

function ensureDir(filePath: string): void {
  const dir = dirname(filePath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

export function loadProcessedSessions(): ProcessedSessions {
  if (!existsSync(PROCESSED_PATH)) return { sessions: {} }
  return JSON.parse(readFileSync(PROCESSED_PATH, 'utf-8')) as ProcessedSessions
}

export function saveProcessedSessions(state: ProcessedSessions): void {
  ensureDir(PROCESSED_PATH)
  writeFileSync(PROCESSED_PATH, JSON.stringify(state, null, 2), 'utf-8')
}

export function markSessionProcessed(
  sessionId: string,
  entry: ProcessedEntry,
  state: ProcessedSessions,
): ProcessedSessions {
  return { sessions: { ...state.sessions, [sessionId]: entry } }
}

export function loadKnownTools(): KnownTools {
  if (!existsSync(KNOWN_TOOLS_PATH)) return { tools: {} }
  return JSON.parse(readFileSync(KNOWN_TOOLS_PATH, 'utf-8')) as KnownTools
}

export function saveKnownTools(tools: KnownTools): void {
  ensureDir(KNOWN_TOOLS_PATH)
  writeFileSync(KNOWN_TOOLS_PATH, JSON.stringify(tools, null, 2), 'utf-8')
}
