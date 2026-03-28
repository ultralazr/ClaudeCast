import { statSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import type { EpisodeRecord } from '../storage/episode-state.js'
import type { PublisherConfig } from './config.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '../..')

function withPrefix(prefix: string | undefined, key: string): string {
  return prefix ? `${prefix.replace(/\/$/, '')}/${key}` : key
}

function episodeR2Key(num: number, prefix?: string): string {
  return withPrefix(prefix, `episodes/ep${String(num).padStart(2, '0')}.m4a`)
}

function episodeUrl(workerUrl: string, num: number, prefix?: string): string {
  return `${workerUrl.replace(/\/$/, '')}/${episodeR2Key(num, prefix)}`
}

function episodeTitle(ep: EpisodeRecord): string {
  if (ep.tagline) return `ClaudeCast #${ep.number} — ${ep.tagline}`
  return `ClaudeCast #${ep.number} — ${ep.projects.join(', ')}`
}

function episodeDescription(ep: EpisodeRecord): string {
  const fmt = (iso: string) => {
    const d = new Date(iso)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }
  return `${ep.projects.join(', ')} · ${fmt(ep.windowStart)}–${fmt(ep.windowEnd)}`
}

function rfcDate(iso: string): string {
  return new Date(iso).toUTCString()
}

function audioFileSize(podcastFile: string): number {
  const abs = resolve(ROOT, podcastFile)
  if (!existsSync(abs)) return 0
  return statSync(abs).size
}

export function generateFeed(
  episodes: EpisodeRecord[],
  cfg: PublisherConfig
): string {
  // Only episodes that have been published (have a local file)
  const sorted = [...episodes].sort((a, b) => a.number - b.number)

  const items = sorted.map((ep) => {
    const url = episodeUrl(cfg.workerUrl, ep.number, cfg.prefix)
    const size = audioFileSize(ep.podcastFile)
    return `
  <item>
    <title>${escapeXml(episodeTitle(ep))}</title>
    <description>${escapeXml(episodeDescription(ep))}</description>
    <pubDate>${rfcDate(ep.windowEnd)}</pubDate>
    <enclosure
      url="${escapeXml(url)}"
      length="${size}"
      type="audio/mp4"/>
    <guid isPermaLink="false">${escapeXml(url)}</guid>
  </item>`
  }).join('\n')

  const feedUrl = `${cfg.workerUrl.replace(/\/$/, '')}/${withPrefix(cfg.prefix, 'feed.xml')}`

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:itunes="http://www.itunes.com/dtds/podcast-1_0.dtd"
  xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(cfg.podcast.title)}</title>
    <description>${escapeXml(cfg.podcast.description)}</description>
    <language>${escapeXml(cfg.podcast.language)}</language>
    <link>${escapeXml(cfg.workerUrl)}</link>
    <atom:link href="${escapeXml(feedUrl)}" rel="self" type="application/rss+xml"/>
    <itunes:author>${escapeXml(cfg.podcast.author)}</itunes:author>
    <itunes:image href="${escapeXml(cfg.workerUrl.replace(/\/$/, ''))}/cover.png"/>
    <itunes:explicit>no</itunes:explicit>
${items}
  </channel>
</rss>
`
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}
