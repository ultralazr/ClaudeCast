import { readFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REDACT_CSV = resolve(__dirname, '../../config/redact.csv')
const PATTERNS_CSV = resolve(__dirname, '../../config/redact-patterns.csv')

// Valid VIN characters: A-Z excluding I, O, Q; plus 0-9
const VIN_CHARS = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789'

/** Deterministic fake VIN — same input always produces the same output. */
function fakeVin(realVin: string): string {
  let seed = 0
  for (let i = 0; i < realVin.length; i++) {
    seed = (seed * 31 + realVin.charCodeAt(i)) >>> 0
  }
  let result = ''
  for (let i = 0; i < 17; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0
    result += VIN_CHARS[seed % VIN_CHARS.length]
  }
  return result
}

interface PatternEntry {
  pattern: RegExp
  replacement: string
}

let _patterns: PatternEntry[] | null = null

function loadPatterns(): PatternEntry[] {
  if (_patterns !== null) return _patterns
  if (!existsSync(PATTERNS_CSV)) {
    console.warn(`[redact] redact-patterns.csv not found — regex patterns disabled. Copy config/redact-patterns.example.csv to get started.`)
    return (_patterns = [])
  }

  const lines = readFileSync(PATTERNS_CSV, 'utf-8').split('\n')
  const entries: PatternEntry[] = []

  for (const line of lines.slice(1)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    // format: pattern,replacement,flags — split at last two commas
    const lastComma = trimmed.lastIndexOf(',')
    const secondLastComma = trimmed.lastIndexOf(',', lastComma - 1)
    if (secondLastComma < 0) continue
    const pattern = trimmed.slice(0, secondLastComma).trim()
    const replacement = trimmed.slice(secondLastComma + 1, lastComma).trim()
    const flags = trimmed.slice(lastComma + 1).trim() || 'g'
    if (!pattern) continue
    try {
      entries.push({ pattern: new RegExp(pattern, flags), replacement })
    } catch (e) {
      console.warn(`[redact] Skipping invalid pattern "${pattern}": ${e}`)
    }
  }

  return (_patterns = entries)
}

interface RedactEntry {
  term: string
  replacement: string
  caseSensitive: boolean
}

let _entries: RedactEntry[] | null = null

function loadEntries(): RedactEntry[] {
  if (_entries !== null) return _entries
  if (!existsSync(REDACT_CSV)) return (_entries = [])

  const lines = readFileSync(REDACT_CSV, 'utf-8').split('\n')
  const entries: RedactEntry[] = []

  for (const line of lines.slice(1)) { // skip header row
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const parts = trimmed.split(',')
    if (parts.length < 2) continue
    const term = parts[0].trim()
    const replacement = parts[1].trim()
    const caseSensitive = parts[2]?.trim().toLowerCase() === 'true'
    if (term) entries.push({ term, replacement, caseSensitive })
  }

  // Longest terms first — prevents a short term shadowing a longer one
  _entries = entries.sort((a, b) => b.term.length - a.term.length)
  return _entries
}

export function redact(text: string): string {
  let result = text

  // 1. Regex patterns from redact-patterns.csv (VINs get deterministic fake replacement)
  for (const { pattern, replacement } of loadPatterns()) {
    if (replacement === '[VIN]') {
      result = result.replace(pattern, (match) => fakeVin(match))
    } else {
      result = result.replace(pattern, replacement)
    }
  }

  // 2. CSV terms (substring replace, longest first)
  for (const { term, replacement, caseSensitive } of loadEntries()) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const flags = caseSensitive ? 'g' : 'gi'
    result = result.replace(new RegExp(escaped, flags), replacement)
  }

  return result
}
