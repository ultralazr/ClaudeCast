import type { SessionEntry, ContentBlock } from './parse-jsonl.js'

interface PiUsage {
  input?: number
  output?: number
  cacheRead?: number
  cacheWrite?: number
}

interface PiContentBlock {
  type: string
  text?: string
  id?: string
  name?: string
  arguments?: Record<string, unknown>
}

interface PiMessage {
  role: 'user' | 'assistant'
  content: PiContentBlock[]
}

interface PiEntry {
  type: string
  id?: string
  timestamp?: string
  cwd?: string
  version?: number
  message?: PiMessage
  usage?: PiUsage
}

function normalizeBlock(block: PiContentBlock): ContentBlock | null {
  if (block.type === 'text') {
    return { type: 'text', text: block.text ?? '' }
  }
  if (block.type === 'toolCall') {
    return {
      type: 'tool_use',
      id: block.id ?? '',
      name: block.name ?? '',
      input: block.arguments ?? {},
    }
  }
  // thinking, toolResult → skip
  return null
}

export function isPiFormat(raw: unknown[]): boolean {
  if (raw.length === 0) return false
  const first = raw[0] as PiEntry
  return first.type === 'session' && typeof first.version === 'number'
}

export function normalizePiEntries(raw: unknown[]): SessionEntry[] {
  const entries = raw as PiEntry[]

  const sessionEntry = entries.find(e => e.type === 'session')
  const sessionId = sessionEntry?.id ?? ''
  const cwd = sessionEntry?.cwd ?? ''

  const normalized: SessionEntry[] = []

  for (const entry of entries) {
    if (entry.type !== 'message' || !entry.message) continue
    const msg = entry.message

    const content: ContentBlock[] = []
    for (const block of msg.content ?? []) {
      const nb = normalizeBlock(block)
      if (nb) content.push(nb)
    }

    const u = entry.usage
    normalized.push({
      type: msg.role,
      sessionId,
      cwd,
      timestamp: entry.timestamp,
      message: {
        role: msg.role,
        content,
        ...(u ? {
          usage: {
            input_tokens: u.input ?? 0,
            output_tokens: u.output ?? 0,
            cache_read_input_tokens: u.cacheRead ?? 0,
            cache_creation_input_tokens: u.cacheWrite ?? 0,
          },
        } : {}),
      },
    })
  }

  return normalized
}
