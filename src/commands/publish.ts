import { existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { loadPublisherConfig } from '../publisher/config.js'
import { generateFeed } from '../publisher/feed.js'
import { r2Upload, r2UploadString } from '../publisher/r2.js'
import { loadEpisodeState, saveEpisodeState } from '../storage/episode-state.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '../..')

interface PublishOptions {
  force: boolean
  dryRun: boolean
}

export async function publishCommand(opts: PublishOptions): Promise<void> {
  const cfg = loadPublisherConfig()
  const state = loadEpisodeState()

  const episodes = Object.values(state.episodes).sort((a, b) => a.number - b.number)

  if (episodes.length === 0) {
    console.log('No episodes found in state.')
    return
  }

  const toPublish = []
  const skipped = []

  for (const ep of episodes) {
    if (ep.publishedAt && !opts.force) {
      skipped.push(`ep${String(ep.number).padStart(2, '0')}: already published`)
      continue
    }
    const absPath = resolve(ROOT, ep.podcastFile)
    if (!existsSync(absPath)) {
      skipped.push(`ep${String(ep.number).padStart(2, '0')}: audio file not found — skipping`)
      continue
    }
    toPublish.push(ep)
  }

  for (const s of skipped) {
    console.log(`  → ${s}`)
  }

  // Upload audio files
  const publishedEps = []
  for (const ep of toPublish) {
    const epKey = `ep${String(ep.number).padStart(2, '0')}`
    const r2Key = cfg.prefix
      ? `${cfg.prefix.replace(/\/$/, '')}/episodes/${epKey}.m4a`
      : `episodes/${epKey}.m4a`
    const absPath = resolve(ROOT, ep.podcastFile)
    console.log(`  → ${epKey}: uploading...`)
    await r2Upload(absPath, r2Key, cfg.bucketName, opts.dryRun)
    if (!opts.dryRun) {
      ep.publishedAt = new Date().toISOString()
      state.episodes[String(ep.number)] = ep
      saveEpisodeState(state)
    }
    publishedEps.push(ep)
  }

  // Regenerate and upload feed.xml from all episodes with a local file
  const publishedAll = Object.values(state.episodes)
    .sort((a, b) => a.number - b.number)
    .filter((ep) => {
      if (opts.dryRun) {
        // In dry-run, treat toPublish as if published
        return existsSync(resolve(ROOT, ep.podcastFile))
      }
      return !!ep.publishedAt
    })

  if (publishedAll.length === 0 && publishedEps.length === 0) {
    console.log('Nothing to publish.')
    return
  }

  const feedEps = opts.dryRun ? publishedAll : publishedAll
  console.log(`  → feed.xml: generating (${feedEps.length} episode${feedEps.length !== 1 ? 's' : ''})...`)
  const feedXml = generateFeed(feedEps, cfg)
  const feedKey = cfg.prefix ? `${cfg.prefix.replace(/\/$/, '')}/feed.xml` : 'feed.xml'
  await r2UploadString(feedXml, feedKey, cfg.bucketName, opts.dryRun)

  const feedUrl = `${cfg.workerUrl.replace(/\/$/, '')}/${feedKey}`
  console.log(`\nDone. Feed URL: ${feedUrl}`)
}
