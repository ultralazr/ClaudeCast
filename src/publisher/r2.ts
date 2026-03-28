import { writeFileSync, unlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { execa } from 'execa'

export async function r2Upload(
  localPath: string,
  r2Key: string,
  bucketName: string,
  dryRun: boolean
): Promise<void> {
  if (dryRun) {
    console.log(`  [dry-run] would upload: ${localPath} → ${bucketName}/${r2Key}`)
    return
  }
  await execa('wrangler', ['r2', 'object', 'put', `${bucketName}/${r2Key}`, '--file', localPath, '--remote'], {
    stdio: 'inherit',
  })
}

export async function r2UploadString(
  content: string,
  r2Key: string,
  bucketName: string,
  dryRun: boolean
): Promise<void> {
  const tmp = join(tmpdir(), `devlog-feed-${Date.now()}.xml`)
  writeFileSync(tmp, content, 'utf-8')
  try {
    await r2Upload(tmp, r2Key, bucketName, dryRun)
  } finally {
    try { unlinkSync(tmp) } catch { /* ignore */ }
  }
}
