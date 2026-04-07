/**
 * Audio post-processing: adds music intro/outro with crossfades,
 * overlays a talker track, converts to mono, and compresses to ~60% filesize.
 *
 * Timeline of final output:
 *   0s       Music intro starts (first 29s of music)
 *   9s       Talker overlay starts (mixed on top of music, no fade)
 *   20s–29s  Crossfade: music fades out, NLM track fades in (9s fade)
 *   23s–...  NLM track (pure)
 *   ...–4s   Outro crossfade: last 4s of NLM fades out into music outro
 *   outro    Remaining music outro plays out (10s outro total)
 */
import { execSync } from 'child_process'
import { execa } from 'execa'
import { existsSync, readdirSync, statSync, unlinkSync } from 'fs'
import { renameSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const WRAPPERS_DIR = resolve(__dirname, '../../data/audio_wrappers')
const ASSETS_DIR = resolve(__dirname, '../../assets/audio')

function resolveAudioFile(name: string): string | null {
  const userFile = join(WRAPPERS_DIR, name)
  if (existsSync(userFile)) return userFile
  // Try alternate extension for music (user may supply .wav, default ships as .mp3)
  if (name === 'music.wav') {
    const defaultMp3 = join(ASSETS_DIR, 'music.mp3')
    if (existsSync(defaultMp3)) return defaultMp3
  }
  const defaultFile = join(ASSETS_DIR, name)
  if (existsSync(defaultFile)) return defaultFile
  return null
}

// Common Windows install locations for ffmpeg (tried in order if not in PATH)
const FFMPEG_WINDOWS_CANDIDATES = [
  join(process.env['LOCALAPPDATA'] ?? '', 'Microsoft', 'WinGet', 'Packages'),
  'C:/ProgramData/chocolatey/bin',
  join(process.env['USERPROFILE'] ?? '', 'scoop', 'shims'),
]

function findFfmpegBin(name: 'ffmpeg' | 'ffprobe'): string {
  // 1. Try PATH first
  try {
    const cmd = process.platform === 'win32' ? `where ${name}` : `which ${name}`
    const result = execSync(cmd, { stdio: 'pipe' }).toString().trim().split('\n')[0]
    if (result) return result.trim()
  } catch { /* not in PATH */ }

  // 2. Probe common Windows locations
  if (process.platform === 'win32') {
    const ext = '.exe'
    const wingetBase = FFMPEG_WINDOWS_CANDIDATES[0]
    if (existsSync(wingetBase)) {
      for (const pkg of readdirSync(wingetBase)) {
        if (pkg.toLowerCase().includes('ffmpeg')) {
          try {
            for (const sub of readdirSync(join(wingetBase, pkg))) {
              const c = join(wingetBase, pkg, sub, 'bin', name + ext)
              if (existsSync(c)) return c
            }
          } catch { /* skip */ }
        }
      }
    }
    for (const dir of FFMPEG_WINDOWS_CANDIDATES.slice(1)) {
      const c = join(dir, name + ext)
      if (existsSync(c)) return c
    }
  }

  throw new Error(
    `Could not find ${name}. Install ffmpeg and add to PATH, or: winget install Gyan.FFmpeg`,
  )
}

function ffmpegBin(name: 'ffmpeg' | 'ffprobe'): string {
  return findFfmpegBin(name)
}

async function getDuration(file: string): Promise<number> {
  const { stdout } = await execa(ffmpegBin('ffprobe'), [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    file,
  ])
  return parseFloat(stdout.trim())
}

async function getBitrate(file: string): Promise<number> {
  const { stdout } = await execa(ffmpegBin('ffprobe'), [
    '-v', 'error',
    '-show_entries', 'format=bit_rate',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    file,
  ])
  return parseInt(stdout.trim(), 10)
}

export async function postProcess(rawFile: string, outFile: string): Promise<void> {
  if (!existsSync(rawFile)) throw new Error(`Input file not found: ${rawFile}`)

  const musicFile = resolveAudioFile('music.wav')
  const talkerFile = resolveAudioFile('talker.mp3')

  if (!musicFile) {
    console.log('  Warning: no music file found — skipping post-processing, using raw NLM audio.')
    if (rawFile !== outFile) {
      const { copyFileSync } = await import('fs')
      copyFileSync(rawFile, outFile)
    }
    return
  }

  if (!talkerFile) {
    console.log('  Note: talker.mp3 not found — skipping talker overlay.')
  }

  console.log('  Post-processing audio...')

  const durations = await Promise.all([
    getDuration(rawFile),
    getDuration(musicFile),
    getBitrate(rawFile),
    ...(talkerFile ? [getDuration(talkerFile)] : []),
  ])

  const nlmDuration = durations[0]
  const musicDuration = durations[1]
  const inputBitrate = durations[2]
  const talkerDuration = talkerFile ? durations[3] : 0

  console.log(`  NLM track: ${nlmDuration.toFixed(1)}s | Music: ${musicDuration.toFixed(1)}s | Input: ${Math.round(inputBitrate / 1000)}k`)

  const outroMusicStart = musicDuration - 10
  const targetBitrate = Math.max(32, Math.min(Math.round(inputBitrate * 0.6 / 1000), 256))
  console.log(`  Target bitrate: ${targetBitrate}k AAC mono (~60% of input)`)

  // Build filter graph — talker overlay is optional
  const talkerEndTime = talkerFile ? 9 + talkerDuration : 0
  const musicFadeStart = talkerEndTime > 0 ? talkerEndTime : -1
  const musicFadeFilter = musicFadeStart > 0 ? `,afade=t=out:st=${musicFadeStart}:d=6` : ''

  const filterParts = [
    `[1:a]atrim=0:29,asetpts=PTS-STARTPTS${musicFadeFilter}[music_intro]`,
    `[1:a]atrim=${outroMusicStart},asetpts=PTS-STARTPTS[music_outro]`,
    `[music_intro][0:a]acrossfade=d=9:c1=tri:c2=nofade[intro_nlm]`,
    `[intro_nlm][music_outro]acrossfade=d=4:c1=tri:c2=tri[with_music]`,
  ]

  let lastLabel = 'with_music'
  const inputs: string[] = [rawFile, musicFile]

  if (talkerFile) {
    const talkerIdx = inputs.length
    inputs.push(talkerFile)
    filterParts.push(`[${talkerIdx}:a]adelay=9000:all=1,volume=1.8[talker]`)
    filterParts.push(`[with_music][talker]amix=inputs=2:duration=first:dropout_transition=2[mixed]`)
    lastLabel = 'mixed'
  }

  filterParts.push(`[${lastLabel}]pan=mono|c0=0.5*c0+0.5*c1[out]`)
  const filter = filterParts.join(';')

  const tmpFile = outFile.replace(/\.m4a$/, '_pp_tmp.m4a')

  try {
    console.log('  Running ffmpeg...')
    const ffmpegArgs = [
      ...inputs.flatMap(f => ['-i', f]),
      '-filter_complex', filter,
      '-map', '[out]',
      '-c:a', 'aac',
      '-b:a', `${targetBitrate}k`,
      '-movflags', '+faststart',
      '-y',
      tmpFile,
    ]
    await execa(ffmpegBin('ffmpeg'), ffmpegArgs)

    if (existsSync(outFile)) unlinkSync(outFile)
    renameSync(tmpFile, outFile)

    const sizeMb = (statSync(outFile).size / 1024 / 1024).toFixed(1)
    console.log(`  Post-processed: ${outFile.split(/[\\/]/).pop()} (${sizeMb} MB, ${targetBitrate}k mono)`)
  } catch (err) {
    if (existsSync(tmpFile)) try { unlinkSync(tmpFile) } catch { /* ignore */ }
    throw err
  }
}
