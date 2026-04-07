import { createReadStream } from 'fs'
import { createInterface } from 'readline'
import { isPiFormat, normalizePiEntries } from './normalize-pi.js'

export interface TextBlock {
  type: 'text'
  text: string
}

export interface ThinkingBlock {
  type: 'thinking'
  thinking: string
}

export interface ToolUseBlock {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}

export interface ToolResultBlock {
  type: 'tool_result'
  tool_use_id: string
  content: unknown
}

export type ContentBlock = TextBlock | ThinkingBlock | ToolUseBlock | ToolResultBlock

export interface TokenUsage {
  inputTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
  outputTokens: number
}

export interface MessagePayload {
  role: 'user' | 'assistant'
  content: string | ContentBlock[]
  usage?: {
    input_tokens?: number
    cache_creation_input_tokens?: number
    cache_read_input_tokens?: number
    output_tokens?: number
  }
}

export interface SessionEntry {
  type: 'user' | 'assistant' | 'progress' | 'file-history-snapshot' | string
  uuid?: string
  parentUuid?: string | null
  isMeta?: boolean
  message?: MessagePayload
  timestamp?: string
  sessionId?: string
  cwd?: string
  version?: string
}

export async function parseJsonl(filePath: string): Promise<SessionEntry[]> {
  const raw: unknown[] = []
  const rl = createInterface({
    input: createReadStream(filePath, { encoding: 'utf-8' }),
    crlfDelay: Infinity,
  })

  for await (const line of rl) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      raw.push(JSON.parse(trimmed))
    } catch {
      // skip malformed lines
    }
  }

  if (isPiFormat(raw)) return normalizePiEntries(raw)
  return raw as SessionEntry[]
}
