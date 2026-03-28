import { execa } from 'execa'
import { writeFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

/** Add an extracted transcript as a text source to an NLM notebook */
export async function addTranscriptSource(
  notebookId: string,
  title: string,
  text: string,
): Promise<void> {
  // NLM CLI doesn't support piping large text via --text for very long sessions
  // Write to a temp file and use --file instead
  const tmpPath = join(tmpdir(), `devlog-transcript-${Date.now()}.txt`)
  try {
    writeFileSync(tmpPath, text, 'utf-8')
    await execa('nlm', ['source', 'add', notebookId, '--file', tmpPath, '--title', title, '--wait'])
  } finally {
    try { unlinkSync(tmpPath) } catch { /* best effort */ }
  }
}

/** Add a reflection markdown file as a source */
export async function addFileSource(
  notebookId: string,
  filePath: string,
  title: string,
): Promise<void> {
  await execa('nlm', ['source', 'add', notebookId, '--file', filePath, '--title', title, '--wait'])
}
