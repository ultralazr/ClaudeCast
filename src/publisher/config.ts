import { readFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CONFIG_PATH = resolve(__dirname, '../../publisher/config.json')

export interface PublisherPodcastMeta {
  title: string
  description: string
  author: string
  language: string
}

export interface PublisherConfig {
  workerUrl: string
  bucketName: string
  podcast: PublisherPodcastMeta
}

const PLACEHOLDER = 'YOUR-SUBDOMAIN'

export function loadPublisherConfig(): PublisherConfig {
  if (!existsSync(CONFIG_PATH)) {
    throw new Error(
      'Publisher not configured. Run: devlog config set-publisher'
    )
  }
  const cfg = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) as PublisherConfig
  if (cfg.workerUrl.includes(PLACEHOLDER)) {
    throw new Error(
      'Publisher worker URL is not set. Run: devlog config set-publisher'
    )
  }
  return cfg
}

export function configPath(): string {
  return CONFIG_PATH
}
