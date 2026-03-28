import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import type { TokenUsage } from '../extractor/parse-jsonl.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const STATE_PATH = resolve(__dirname, '../../data/state/episodes.json')

export interface EpisodeRecord {
  number: number
  windowStart: string  // UTC ISO
  windowEnd: string    // UTC ISO
  projects: string[]
  podcastFile: string
  tagline: string
  completedAt: string
  publishedAt?: string  // set when uploaded to R2
  tokenUsage?: TokenUsage
}

export interface EpisodeState {
  lastEpisodeNumber: number
  lastRunAt: string | null
  lastRunContentEnd: string | null  // latest message timestamp included in last run
  episodes: Record<string, EpisodeRecord>
}

function ensureDir(p: string): void {
  const d = dirname(p)
  if (!existsSync(d)) mkdirSync(d, { recursive: true })
}

export function loadEpisodeState(): EpisodeState {
  if (!existsSync(STATE_PATH)) {
    return { lastEpisodeNumber: 0, lastRunAt: null, lastRunContentEnd: null, episodes: {} }
  }
  return JSON.parse(readFileSync(STATE_PATH, 'utf-8')) as EpisodeState
}

export function saveEpisodeState(state: EpisodeState): void {
  ensureDir(STATE_PATH)
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), 'utf-8')
}

export function isEpisodeComplete(number: number, state: EpisodeState): boolean {
  return !!state.episodes[String(number)]
}

export function recordEpisode(episode: EpisodeRecord, state: EpisodeState): EpisodeState {
  return {
    ...state,
    lastEpisodeNumber: Math.max(state.lastEpisodeNumber, episode.number),
    lastRunAt: new Date().toISOString(),
    episodes: { ...state.episodes, [String(episode.number)]: episode },
  }
}
