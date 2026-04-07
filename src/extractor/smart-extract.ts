import { parseJsonl, type SessionEntry, type ContentBlock, type TokenUsage } from './parse-jsonl.js'
import { redact } from './redact.js'

export interface ExtractedSession {
  sessionId: string
  cwd: string
  startTime: string
  endTime: string
  durationMinutes: number
  toolsUsed: string[]
  filesModified: string[]
  skillsUsed: string[]
  mcpsUsed: string[]
  conversationText: string
  tokenUsage: TokenUsage
}

// Tags to strip from user messages
const STRIP_PATTERNS = [
  /<system-reminder>[\s\S]*?<\/system-reminder>/g,
  /<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g,
  /<local-command-stdout>[\s\S]*?<\/local-command-stdout>/g,
  /<local-command-stderr>[\s\S]*?<\/local-command-stderr>/g,
  /<command-name>[\s\S]*?<\/command-name>/g,
  /<command-message>[\s\S]*?<\/command-message>/g,
  /<command-args>[\s\S]*?<\/command-args>/g,
]

function stripSystemTags(text: string): string {
  let result = text
  for (const pattern of STRIP_PATTERNS) {
    result = result.replace(pattern, '')
  }
  return result.trim()
}

function extractTextFromContent(content: string | ContentBlock[]): {
  text: string
  tools: string[]
  files: string[]
  skills: string[]
} {
  if (typeof content === 'string') {
    return { text: stripSystemTags(content), tools: [], files: [], skills: [] }
  }

  const textParts: string[] = []
  const tools: string[] = []
  const files: string[] = []
  const skills: string[] = []

  for (const block of content) {
    if (block.type === 'text') {
      textParts.push(block.text)
    } else if (block.type === 'tool_use') {
      tools.push(block.name)
      // Extract file paths from Edit/Write/Read tool calls
      if (['Edit', 'Write', 'Read'].includes(block.name)) {
        const fp = (block.input as Record<string, string>)['file_path']
        if (fp) files.push(fp)
      }
      // Extract skill names from Skill tool calls
      if (block.name === 'Skill') {
        const skillName = (block.input as Record<string, string>)['skill']
        if (skillName) skills.push(skillName)
      }
    }
    // Skip thinking, tool_result
  }

  return { text: textParts.join('\n'), tools, files, skills }
}

export interface ExtractOptions {
  /** Only include messages at or after this UTC timestamp (inclusive) */
  windowStart?: Date
  /** Only include messages before this UTC timestamp (exclusive) */
  windowEnd?: Date
  /** Skip redaction (use when the source has already been redacted externally) */
  skipRedact?: boolean
  /** Label for the AI agent in the transcript (default: "Claude") */
  agentName?: string
  /** Label for the human developer in the transcript (default: "User") */
  humanName?: string
}

export async function extractSession(
  jsonlPath: string,
  options: ExtractOptions = {},
): Promise<ExtractedSession | null> {
  const entries = await parseJsonl(jsonlPath)
  if (entries.length === 0) return null

  const wsMs = options.windowStart?.getTime() ?? -Infinity
  const weMs = options.windowEnd?.getTime() ?? Infinity
  const agentName = options.agentName ?? 'Claude'
  const humanName = options.humanName ?? 'User'

  const lines: string[] = []
  const allTools = new Set<string>()
  const allFiles = new Set<string>()
  const allSkills = new Set<string>()
  let sessionId = ''
  let cwd = ''
  let startTime = ''
  let endTime = ''
  const activeTimestamps: number[] = []  // ms timestamps of all entries in window
  const tokenUsage: TokenUsage = { inputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, outputTokens: 0 }

  for (const entry of entries) {
    if (!entry.timestamp) continue

    // Always capture metadata from any entry regardless of window
    if (entry.sessionId && !sessionId) sessionId = entry.sessionId
    if (entry.cwd && !cwd) cwd = entry.cwd

    // Apply window filter for content
    const entryMs = new Date(entry.timestamp).getTime()
    if (entryMs < wsMs || entryMs >= weMs) continue

    if (!startTime) startTime = entry.timestamp
    endTime = entry.timestamp
    activeTimestamps.push(entryMs)

    if (entry.type === 'user' && entry.message?.role === 'user') {
      const { text } = extractTextFromContent(entry.message.content)
      if (text) lines.push(`**${humanName}:** ${text}`)
    } else if (entry.type === 'assistant' && entry.message?.role === 'assistant') {
      const { text, tools, files, skills } = extractTextFromContent(entry.message.content)
      if (text) lines.push(`**${agentName}:** ${text}`)
      if (tools.length > 0) lines.push(`  *[Tools used: ${tools.join(', ')}]*`)
      tools.forEach(t => allTools.add(t))
      files.forEach(f => allFiles.add(f))
      skills.forEach(s => allSkills.add(s))
      const u = entry.message.usage
      if (u) {
        tokenUsage.inputTokens += u.input_tokens ?? 0
        tokenUsage.cacheCreationTokens += u.cache_creation_input_tokens ?? 0
        tokenUsage.cacheReadTokens += u.cache_read_input_tokens ?? 0
        tokenUsage.outputTokens += u.output_tokens ?? 0
      }
    }
  }

  if (!sessionId || !cwd) return null
  // No messages fell within the requested window
  if (!startTime) return null

  // Active time: sum of consecutive gaps <= 30 min, ignoring idle stretches
  const GAP_THRESHOLD_MS = 30 * 60 * 1000
  let activeMs = 0
  for (let i = 1; i < activeTimestamps.length; i++) {
    const gap = activeTimestamps[i] - activeTimestamps[i - 1]
    if (gap <= GAP_THRESHOLD_MS) activeMs += gap
  }
  const durationMinutes = Math.max(1, Math.round(activeMs / 60000))

  // Separate MCP tools from regular tools
  const mcpsUsed = [...allTools].filter(t => t.startsWith('mcp__'))
  const toolsUsed = [...allTools].filter(t => !t.startsWith('mcp__'))

  const metaHeader = [
    `# Session Transcript`,
    ``,
    `**Session ID:** ${sessionId}`,
    `**Project directory:** ${cwd}`,
    `**Start:** ${startTime}`,
    `**End:** ${endTime}`,
    `**Duration:** ${durationMinutes} minutes`,
    `**Tools used:** ${toolsUsed.join(', ') || 'none'}`,
    `**MCP servers:** ${mcpsUsed.join(', ') || 'none'}`,
    `**Skills invoked:** ${[...allSkills].join(', ') || 'none'}`,
    `**Files modified:** ${[...allFiles].join(', ') || 'none'}`,
    ``,
    `---`,
    ``,
  ].join('\n')

  return {
    sessionId,
    cwd,
    startTime,
    endTime,
    durationMinutes,
    toolsUsed,
    filesModified: [...allFiles],
    skillsUsed: [...allSkills],
    mcpsUsed,
    conversationText: options.skipRedact ? metaHeader + lines.join('\n\n') : redact(metaHeader + lines.join('\n\n')),
    tokenUsage,
  }
}
