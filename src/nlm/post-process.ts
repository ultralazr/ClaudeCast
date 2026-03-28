/**
 * Audio post-processing: adds music intro/outro with crossfades,
 * overlays a talker track, converts to mono, and compresses to ~60% filesize.
 *
 * Timeline of final output:
 *   0s       Music intro starts (first 23s of neon-odyssey.wav)
 *   9s       Talker overlay starts (mixed on top of music, no fade)
 *   18s–23s  Crossfade: music fades out, NLM track fades in (5s fade)
 *   23s–...  NLM track (pure)
 *   ...–4s   Outro crossfade: last 4s of NLM fades out into music outro
 *   outro    Remaining music outro plays out (10s outro total)
 */
import { execa } from 'execa'
import { existsSync, statSync, unlinkSync } from 'fs'
import { renameSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const WRAPPERS_DIR = resolve(__dirname, '../../data/audio_wrappers')

const MUSIC_FILE = join(WRAPPERS_DIR, 'music.wav')
const TALKER_FILE = join(WRAPPERS_DIR, 'talker.mp3')

// Common Windows install locations for ffmpeg (tried in order if not in PATH)
const FFMPEG_WINDOWS_CANDIDATES = [
  join(process.env['LOCALAPPDATA'] ?? '', 'Microsoft', 'WinGet', 'Packages'),
  'C:/ProgramData/chocolatey/bin',
  join(process.env['USERPROFILE'] ?? '', 'scoop', 'shims'),
]

function findFfmpegBin(name: 'ffmpeg' | 'ffprobe'): string {
  // 1. Try PATH first
  try {
    const { execSync } = require('child_process') as typeof import('child_process')
    const cmd = process.platform === 'win32' ? `where ${name}` : `which ${name}`
    const result = execSync(cmd, { stdio: 'pipe' }).toString().trim().split('\n')[0]
    if (result) return result.trim()
  } catch { /* not in PATH */ }

  // 2. Probe common Windows locations
  if (process.platform === 'win32') {
    const { readdirSync, existsSync: exists } = require('fs') as typeof import('fs')
    const ext = '.exe'
    const wingetBase = FFMPEG_WINDOWS_CANDIDATES[0]
    if (exists(wingetBase)) {
      for (const pkg of readdirSync(wingetBase)) {
        if (pkg.toLowerCase().includes('ffmpeg')) {
          try {
            for (const sub of readdirSync(join(wingetBase, pkg))) {
              const c = join(wingetBase, pkg, sub, 'bin', name + ext)
              if (exists(c)) return c
            }
          } catch { /* skip */ }
        }
      }
    }
    for (const dir of FFMPEG_WINDOWS_CANDIDATES.slice(1)) {
      const { existsSync: exists2 } = require('fs') as typeof import('fs')
      const c = join(dir, name + ext)
      if (exists2(c)) return c
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
  if (!existsSync(MUSIC_FILE)) throw new Error(`Music file not found: ${MUSIC_FILE}`)
  if (!existsSync(TALKER_FILE)) throw new Error(`Talker file not found: ${TALKER_FILE}`)

  console.log('  Post-processing audio...')

  const [nlmDuration, musicDuration, inputBitrate] = await Promise.all([
    getDuration(rawFile),
    getDuration(MUSIC_FILE),
    getBitrate(rawFile),
  ])

  console.log(`  NLM track: ${nlmDuration.toFixed(1)}s | Music: ${musicDuration.toFixed(1)}s | Input: ${Math.round(inputBitrate / 1000)}k`)

  const outroMusicStart = musicDuration - 10   // start of the last 10s of music
  const targetBitrate = Math.max(32, Math.min(Math.round(inputBitrate * 0.6 / 1000), 256))
  console.log(`  Target bitrate: ${targetBitrate}k AAC mono (~60% of input)`)

  // Filter graph:
  //   [1:a] trim 0→23s  → [music_intro]
  //   [1:a] trim last10s → [music_outro]
  //   [music_intro][0:a] acrossfade d=5 → [intro_nlm]   (crossfade at 18s–23s of music)
  //   [intro_nlm][music_outro] acrossfade d=4 → [with_music]
  //   [2:a] adelay 9000ms → [talker]
  //   [with_music][talker] amix duration=first → [mixed]
  //   [mixed] pan mono → [out]
  const filter = [
    `[1:a]atrim=0:23,asetpts=PTS-STARTPTS[music_intro]`,
    `[1:a]atrim=${outroMusicStart},asetpts=PTS-STARTPTS[music_outro]`,
    `[music_intro][0:a]acrossfade=d=5:c1=tri:c2=nofade[intro_nlm]`,
    `[intro_nlm][music_outro]acrossfade=d=4:c1=tri:c2=tri[with_music]`,
    `[2:a]adelay=9000:all=1,volume=1.8[talker]`,
    `[with_music][talker]amix=inputs=2:duration=first:dropout_transition=2[mixed]`,
    `[mixed]pan=mono|c0=0.5*c0+0.5*c1[out]`,
  ].join(';')

  const tmpFile = outFile.replace(/\.m4a$/, '_pp_tmp.m4a')

  try {
    console.log('  Running ffmpeg...')
    await execa(ffmpegBin('ffmpeg'), [
      '-i', rawFile,
      '-i', MUSIC_FILE,
      '-i', TALKER_FILE,
      '-filter_complex', filter,
      '-map', '[out]',
      '-c:a', 'aac',
      '-b:a', `${targetBitrate}k`,
      '-movflags', '+faststart',
      '-y',
      tmpFile,
    ])

    if (existsSync(outFile)) unlinkSync(outFile)
    renameSync(tmpFile, outFile)

    const sizeMb = (statSync(outFile).size / 1024 / 1024).toFixed(1)
    console.log(`  Post-processed: ${outFile.split(/[\\/]/).pop()} (${sizeMb} MB, ${targetBitrate}k mono)`)
  } catch (err) {
    if (existsSync(tmpFile)) try { unlinkSync(tmpFile) } catch { /* ignore */ }
    throw err
  }
}
