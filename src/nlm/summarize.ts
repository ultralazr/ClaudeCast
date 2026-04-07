import { execa } from 'execa'

function makeSummaryPrompt(agentName: string): string {
  return `You are summarizing a ${agentName} development session transcript.
Write a concise but thorough summary of this session. Cover:
1. What was built, changed, or investigated
2. Key decisions made and why
3. Problems encountered and how they were resolved
4. Tools, libraries, or services introduced
5. Outcomes and current state

Scale the length to match complexity: a short debugging session gets 2-3 sentences; a 4-hour design+implementation session gets a full page. Write in past tense, third person is fine.`
}

export async function summarizeSession(notebookId: string, agentName = 'Claude'): Promise<string> {
  const { stdout } = await execa('nlm', [
    'notebook',
    'query',
    notebookId,
    makeSummaryPrompt(agentName),
    '--json',
  ])
  const result = JSON.parse(stdout) as { value?: { answer?: string }; answer?: string }
  return result.value?.answer ?? result.answer ?? stdout
}
