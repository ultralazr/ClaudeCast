export type ToolCategory = 'builtin' | 'mcp' | 'skill'

export interface ToolRecord {
  firstSeen: string
  category: ToolCategory
}

export interface KnownTools {
  tools: Record<string, ToolRecord>
}

export function categorize(toolName: string): ToolCategory {
  if (toolName.startsWith('mcp__')) return 'mcp'
  // Skills are invoked via the Skill tool with a skill name arg — captured separately
  return 'builtin'
}

/** Return tool names that appear in this session but not in knownTools */
export function findNewTools(sessionTools: string[], knownTools: KnownTools): string[] {
  return sessionTools.filter(t => !knownTools.tools[t])
}

/** Merge session tools into knownTools, returning updated state */
export function mergeTools(
  sessionTools: string[],
  knownTools: KnownTools,
  date: string,
): KnownTools {
  const updated = { tools: { ...knownTools.tools } }
  for (const tool of sessionTools) {
    if (!updated.tools[tool]) {
      updated.tools[tool] = { firstSeen: date, category: categorize(tool) }
    }
  }
  return updated
}
