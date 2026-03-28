import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync } from 'fs'
import { join, dirname } from 'path'
import { resolve } from 'path'
import { fileURLToPath } from 'url'
import matter from 'gray-matter'

const __dirname = dirname(fileURLToPath(import.meta.url))
const LOGS_DIR = resolve(__dirname, '../../data/logs')

export interface LogEntryFrontmatter {
  date: string
  project: string
  projectPath: string
  sessionId: string
  duration: string
  toolsUsed: string[]
  newTools: string[]
  mcpsUsed: string[]
  skillsUsed: string[]
  week: string
}

export interface ReflectionFrontmatter {
  week: string
  project: string
  date: string
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

export function writeLogEntry(
  project: string,
  date: string,
  sessionId: string,
  frontmatter: LogEntryFrontmatter,
  summary: string,
  newToolsList: string[],
  mcpsList: string[],
  skillsList: string[],
): string {
  const projectDir = join(LOGS_DIR, project)
  ensureDir(projectDir)

  const shortId = sessionId.slice(0, 8)
  const filename = `${date}_session-${shortId}.md`
  const filePath = join(projectDir, filename)

  const toolsSection =
    newToolsList.length > 0 || mcpsList.length > 0 || skillsList.length > 0
      ? [
          '',
          '## Tools & Skills',
          newToolsList.length > 0 ? `- **New this session**: ${newToolsList.join(', ')}` : null,
          mcpsList.length > 0 ? `- **MCP servers**: ${mcpsList.join(', ')}` : null,
          skillsList.length > 0 ? `- **Skills invoked**: ${skillsList.join(', ')}` : null,
        ]
          .filter(Boolean)
          .join('\n')
      : ''

  const body = `# Session: ${project} — ${date}\n\n## Summary\n${summary}${toolsSection}\n`

  const fileContent = matter.stringify(body, frontmatter as unknown as Record<string, unknown>)
  writeFileSync(filePath, fileContent, 'utf-8')
  return filePath
}

export function appendOrCreateReflection(
  project: string,
  week: string,
  date: string,
  sessionSummaries: Array<{ date: string; oneLiner: string }>,
  userNotes: string,
): string {
  const projectDir = join(LOGS_DIR, project)
  ensureDir(projectDir)

  const filename = `${week}_reflection.md`
  const filePath = join(projectDir, filename)

  if (existsSync(filePath)) {
    // Append to existing file
    const existing = readFileSync(filePath, 'utf-8')
    const appended = `${existing}\n\n---\n\n*Updated ${date}*\n\n${userNotes}\n`
    writeFileSync(filePath, appended, 'utf-8')
  } else {
    const sessionsBlock = sessionSummaries
      .map(s => `- ${s.date}: ${s.oneLiner}`)
      .join('\n')

    const frontmatter: ReflectionFrontmatter = { week, project, date }
    const body = [
      `# Weekly Reflection: ${project} — ${week}`,
      '',
      '## Sessions This Week',
      sessionsBlock,
      '',
      '## My Notes',
      userNotes,
      '',
    ].join('\n')

    const fileContent = matter.stringify(body, frontmatter as unknown as Record<string, unknown>)
    writeFileSync(filePath, fileContent, 'utf-8')
  }
  return filePath
}

export interface LogEntry {
  filePath: string
  frontmatter: LogEntryFrontmatter
  summary: string
}

export function readLogEntries(project?: string): LogEntry[] {
  const searchDir = project ? join(LOGS_DIR, project) : LOGS_DIR
  if (!existsSync(searchDir)) return []

  const entries: LogEntry[] = []

  function readDir(dir: string): void {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, item.name)
      if (item.isDirectory()) {
        readDir(fullPath)
      } else if (item.isFile() && item.name.endsWith('.md') && item.name.includes('session-')) {
        try {
          const content = readFileSync(fullPath, 'utf-8')
          const parsed = matter(content)
          entries.push({
            filePath: fullPath,
            frontmatter: parsed.data as LogEntryFrontmatter,
            summary: parsed.content,
          })
        } catch {
          // skip
        }
      }
    }
  }

  readDir(searchDir)
  return entries.sort((a, b) => a.frontmatter.date.localeCompare(b.frontmatter.date))
}
