import { execa } from 'execa'
import { getISOWeek, getISOWeekYear } from 'date-fns'

export interface NLMNotebook {
  id: string
  title: string
}

export function getWeekLabel(date: Date): string {
  const week = getISOWeek(date)
  const year = getISOWeekYear(date)
  return `${year}-W${String(week).padStart(2, '0')}`
}

/** List all notebooks and find one matching the title */
async function findNotebook(title: string): Promise<string | null> {
  const { stdout } = await execa('nlm', ['notebook', 'list', '--json'])
  const notebooks = JSON.parse(stdout) as Array<{ id: string; title: string }>
  const found = notebooks.find(n => n.title === title)
  return found?.id ?? null
}

/** Get or create the weekly dev log notebook, returns notebook ID */
export async function getOrCreateWeeklyNotebook(prefix: string, weekLabel: string): Promise<string> {
  const title = `${prefix} — ${weekLabel}`

  const existingId = await findNotebook(title)
  if (existingId) return existingId

  console.log(`  Creating NLM notebook: "${title}"`)
  // notebook create outputs plain text: "✓ Created notebook: ...\n  ID: <uuid>"
  const { stdout } = await execa('nlm', ['notebook', 'create', title])
  const match = stdout.match(/ID:\s*([a-f0-9-]{36})/i)
  if (!match?.[1]) throw new Error(`Could not parse notebook ID from output: ${stdout}`)
  return match[1]
}
