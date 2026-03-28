import { execa } from 'execa'
import { writeFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const nlm = (...args: string[]) => execa('nlm', args)
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

console.log('Creating notebook...')
const { stdout: createOut } = await nlm('notebook', 'create', 'TEST probe status')
const m = createOut.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
const id = m![0]
console.log('Notebook ID:', id)

const tmpPath = join(tmpdir(), 'probe-source.txt')
writeFileSync(tmpPath, 'Short test. Built a pipeline. It worked.')
await nlm('source', 'add', id, '--file', tmpPath, '--title', 'Test', '--wait')
unlinkSync(tmpPath)

await sleep(30_000)

console.log('Creating audio...')
await nlm('audio', 'create', id, '--format', 'deep_dive', '--confirm')

console.log('Checking status (raw JSON)...')
await sleep(5_000)
const { stdout } = await nlm('studio', 'status', id, '--json')
console.log('RAW STATUS:', stdout)

console.log('Deleting...')
try { await nlm('notebook', 'delete', id, '--confirm') } catch {}
