import { input, confirm } from '@inquirer/prompts'
import { existsSync, writeFileSync, copyFileSync, mkdirSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { execa } from 'execa'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '../..')
const CONFIG_PATH = resolve(ROOT, 'config/projects.json')
const PUBLISHER_CONFIG_PATH = resolve(ROOT, 'publisher/config.json')
const REDACT_CSV = resolve(ROOT, 'config/redact.csv')
const PATTERNS_CSV = resolve(ROOT, 'config/redact-patterns.csv')
const REDACT_EXAMPLE = resolve(ROOT, 'config/redact.example.csv')
const PATTERNS_EXAMPLE = resolve(ROOT, 'config/redact-patterns.example.csv')
const AUDIO_WRAPPERS_DIR = resolve(ROOT, 'data/audio_wrappers')

function defaultClaudeDir(): string {
  const home = process.env['USERPROFILE'] ?? process.env['HOME'] ?? ''
  return resolve(home, '.claude')
}

async function checkFfmpeg(): Promise<boolean> {
  try {
    await execa('ffmpeg', ['-version'], { stdio: 'pipe' })
    return true
  } catch {
    // Try common Windows locations
    const { existsSync: exists } = await import('fs')
    const { join } = await import('path')
    const wingetBase = join(process.env['LOCALAPPDATA'] ?? '', 'Microsoft', 'WinGet', 'Packages')
    if (exists(wingetBase)) {
      const { readdirSync } = await import('fs')
      for (const pkg of readdirSync(wingetBase)) {
        if (pkg.toLowerCase().includes('ffmpeg')) return true
      }
    }
    const choco = 'C:/ProgramData/chocolatey/bin/ffmpeg.exe'
    const scoop = join(process.env['USERPROFILE'] ?? '', 'scoop/shims/ffmpeg.exe')
    return exists(choco) || exists(scoop)
  }
}

async function checkNotebooklmTools(): Promise<boolean> {
  try {
    await execa('python', ['-c', 'import notebooklm_tools'], { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

function checkAudioWrappers(): { music: boolean; talker: boolean } {
  return {
    music: existsSync(resolve(AUDIO_WRAPPERS_DIR, 'music.wav')),
    talker: existsSync(resolve(AUDIO_WRAPPERS_DIR, 'talker.mp3')),
  }
}

export async function initCommand(): Promise<void> {
  console.log('ClaudeCast Setup\n')
  console.log('This wizard will create your personal config files.\n')

  // ── Claude data dir ─────────────────────────────────────────────────────────
  const defaultDir = defaultClaudeDir()
  const claudeDataDir = await input({
    message: 'Claude data directory (where your ~/.claude folder is):',
    default: defaultDir,
    validate: (v) => existsSync(v) ? true : `Directory not found: ${v}`,
  })

  // ── Publisher config (optional) ─────────────────────────────────────────────
  const wantPublisher = await confirm({
    message: 'Configure Cloudflare publishing? (needed for devlog publish)',
    default: false,
  })

  let workerUrl = ''
  let bucketName = ''
  let podcastTitle = 'ClaudeCast'
  let podcastAuthor = ''
  let podcastDescription = 'AI-assisted development podcast'

  if (wantPublisher) {
    workerUrl = await input({ message: 'Cloudflare Worker URL:', default: '' })
    bucketName = await input({ message: 'R2 bucket name:', default: '' })
    podcastTitle = await input({ message: 'Podcast title:', default: 'ClaudeCast' })
    podcastAuthor = await input({ message: 'Podcast author name:', default: '' })
    podcastDescription = await input({
      message: 'Podcast description:',
      default: 'AI-assisted development podcast',
    })
  }

  // ── Write config files ──────────────────────────────────────────────────────
  const projectsConfig = {
    projectMappings: {},
    claudeDataDir,
    nlmNotebookPrefix: 'Dev Log',
    minSessionMinutes: 5,
  }
  writeFileSync(CONFIG_PATH, JSON.stringify(projectsConfig, null, 2), 'utf-8')
  console.log(`\n✓ Wrote ${CONFIG_PATH}`)

  const publisherConfig = { workerUrl, bucketName, podcastTitle, podcastAuthor, podcastDescription }
  writeFileSync(PUBLISHER_CONFIG_PATH, JSON.stringify(publisherConfig, null, 2), 'utf-8')
  console.log(`✓ Wrote ${PUBLISHER_CONFIG_PATH}`)

  // ── Copy example redact files if they don't exist ───────────────────────────
  if (!existsSync(REDACT_CSV) && existsSync(REDACT_EXAMPLE)) {
    copyFileSync(REDACT_EXAMPLE, REDACT_CSV)
    console.log(`✓ Created ${REDACT_CSV} from example`)
  }
  if (!existsSync(PATTERNS_CSV) && existsSync(PATTERNS_EXAMPLE)) {
    copyFileSync(PATTERNS_EXAMPLE, PATTERNS_CSV)
    console.log(`✓ Created ${PATTERNS_CSV} from example`)
  }

  // ── Ensure data dirs exist ───────────────────────────────────────────────────
  for (const dir of ['data/episodes', 'data/logs', 'data/state', 'data/audio_wrappers']) {
    const full = resolve(ROOT, dir)
    if (!existsSync(full)) mkdirSync(full, { recursive: true })
  }

  // ── Validation ───────────────────────────────────────────────────────────────
  console.log('\nChecking prerequisites...')

  const ffmpegOk = await checkFfmpeg()
  console.log(ffmpegOk
    ? '  ✓ ffmpeg found'
    : '  ✗ ffmpeg not found — install it and add to PATH, or: winget install Gyan.FFmpeg')

  const nlmToolsOk = await checkNotebooklmTools()
  console.log(nlmToolsOk
    ? '  ✓ notebooklm-tools found'
    : '  ✗ notebooklm-tools not found — run: pip install notebooklm-tools')

  const { music, talker } = checkAudioWrappers()
  console.log(music
    ? '  ✓ data/audio_wrappers/music.wav found'
    : '  ✗ data/audio_wrappers/music.wav not found — add your intro music file')
  console.log(talker
    ? '  ✓ data/audio_wrappers/talker.mp3 found'
    : '  ✗ data/audio_wrappers/talker.mp3 not found — add your talker overlay file')

  console.log('\nSetup complete.')
  if (Object.keys(projectsConfig.projectMappings).length === 0) {
    console.log('Tip: map your project paths with: devlog config add-project <path> <name>')
  }
}
