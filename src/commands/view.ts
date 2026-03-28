import { readLogEntries } from '../storage/markdown.js'

export function viewLogs(project?: string, week?: string): void {
  let entries = readLogEntries(project)

  if (week) {
    entries = entries.filter(e => e.frontmatter.week === week)
  }

  if (entries.length === 0) {
    const filter = [project && `project "${project}"`, week && `week ${week}`].filter(Boolean).join(', ')
    console.log(`No log entries found${filter ? ` for ${filter}` : ''}.`)
    return
  }

  console.log(`\nFound ${entries.length} log entries:\n`)
  for (const entry of entries) {
    const { date, project: proj, duration, toolsUsed, newTools } = entry.frontmatter
    const newToolsTag = newTools?.length > 0 ? ` [NEW: ${newTools.join(', ')}]` : ''
    console.log(`  ${date}  ${proj.padEnd(20)} ${duration}${newToolsTag}`)
    console.log(`    ${entry.filePath}`)
    // Print first 2 lines of summary
    const summaryLines = entry.summary.split('\n').filter(l => l.trim()).slice(0, 2)
    for (const line of summaryLines) {
      console.log(`    ${line.slice(0, 100)}`)
    }
    console.log()
  }
}
