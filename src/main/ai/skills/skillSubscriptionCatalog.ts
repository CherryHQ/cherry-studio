import { createHash } from 'node:crypto'

import { net } from 'electron'
import { XMLParser, XMLValidator } from 'fast-xml-parser'
import * as z from 'zod'

import type {
  MarketplaceSkillDetail,
  SkillSubscriptionSnapshot,
  SkillSubscriptionSource
} from '@shared/types/skillMarketplace'
import { buildGithubSkillResult } from '@shared/utils/skillMarketplace'
import { normalizeSubscriptionUrl, skillInstallIdentity } from '@shared/utils/skillSubscription'

import { readGithubSkillCatalog } from './skillRemoteSource'

const MAX_FEED_BYTES = 16 * 1024 * 1024
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
const text = (value: unknown): string => (typeof value === 'string' ? value : '')
const array = (value: unknown): unknown[] => (Array.isArray(value) ? value : value ? [value] : [])
const plainText = (value: unknown) =>
  text(value)
    .replace(/<[^>]*>/g, '')
    .trim()
const localized = (value: string) => ({ en: value, zh: null })

function skillItem(sourceId: string, url: string, kind: 'github' | 'zip', name: string): MarketplaceSkillDetail {
  const identity = createHash('sha256').update(skillInstallIdentity(url)).digest('hex')
  return {
    id: sourceId + ':' + identity,
    subscription: { sourceId, url, kind },
    name: localized(name),
    description: localized(''),
    longDescription: localized(''),
    domain: 'Other',
    author: '',
    version: '',
    tags: [],
    githubRepoUrl: null,
    sourceUrl: url,
    icon: null,
    packageName: null,
    packageSize: null,
    hasPackage: true,
    downloadUrl: kind === 'zip' ? url : null,
    downloads: null,
    releaseDate: '',
    membersKnown: kind === 'github',
    isCollection: false,
    members: kind === 'github' ? [{ path: '', name }] : []
  }
}

function installTarget(value: unknown, base: string, mime = '') {
  try {
    const url = normalizeSubscriptionUrl(new URL(text(value), base).href)
    if (!text(value) || !url) return null
    const github = buildGithubSkillResult(url)
    if (github?.sourceUrl) return { kind: 'github' as const, url: github.sourceUrl }
    if (/\.zip$/i.test(new URL(url).pathname) || ['application/zip', 'application/x-zip-compressed'].includes(mime)) {
      return { kind: 'zip' as const, url }
    }
  } catch {
    /* Invalid feed entries are skipped independently. */
  }
  return null
}

async function readFeed(url: string, signal: AbortSignal) {
  const response = await net.fetch(url, { signal, credentials: 'omit' })
  if (!response.ok) throw new Error('HTTP ' + response.status)
  if (!response.body) throw new Error('Empty subscription response')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_FEED_BYTES) throw new Error('Subscription response exceeds size limit')
      chunks.push(value)
    }
    return { body: new TextDecoder().decode(Buffer.concat(chunks)), url: response.url || url, size }
  } finally {
    await reader.cancel()
  }
}

const jsonFeedSchema = z.object({
  version: z.enum(['https://jsonfeed.org/version/1', 'https://jsonfeed.org/version/1.1']),
  title: z.string().min(1),
  items: z.array(z.unknown()),
  next_url: z.string().optional()
})

export async function readSkillSubscription(
  source: SkillSubscriptionSource,
  signal: AbortSignal
): Promise<SkillSubscriptionSnapshot> {
  if (new URL(source.url).hostname === 'github.com') {
    const catalog = await readGithubSkillCatalog(source.url)
    signal.throwIfAborted()
    return {
      source: { ...source, kind: 'github', name: catalog.name },
      fetchedAt: Date.now(),
      skipped: catalog.skipped,
      items: catalog.items.map(({ metadata, sourceUrl, content }) => ({
        ...skillItem(source.id, sourceUrl, 'github', metadata.name),
        description: localized(metadata.description ?? ''),
        longDescription: localized(content),
        author: metadata.author ?? catalog.name.split('/')[0],
        version: metadata.version ?? '',
        tags: metadata.tags ?? [],
        githubRepoUrl: source.url
      }))
    }
  }
  const items = new Map<string, MarketplaceSkillDetail>()
  const visited = new Set<string>()
  let next: string | null = source.url
  let sourceName = ''
  let kind: 'json' | 'rss' | undefined
  let skipped = 0
  let totalBytes = 0
  while (next) {
    if (visited.has(next) || visited.size >= 100) throw new Error('Invalid subscription pagination')
    visited.add(next)
    const page = await readFeed(next, AbortSignal.any([signal, AbortSignal.timeout(15_000)]))
    totalBytes += page.size
    if (totalBytes > MAX_FEED_BYTES) throw new Error('Subscription catalog exceeds size limit')
    let entries: unknown[]
    const json = page.body.trimStart().startsWith('{')
    if (kind && kind !== (json ? 'json' : 'rss')) throw new Error('Subscription format changed between pages')
    if (json) {
      const feed = jsonFeedSchema.parse(JSON.parse(page.body))
      kind = 'json'
      sourceName ||= feed.title
      entries = feed.items
      next = feed.next_url ? normalizeSubscriptionUrl(new URL(feed.next_url, page.url).href) : null
      if (feed.next_url && !next) throw new Error('Invalid subscription next URL')
    } else {
      if (/<!DOCTYPE|<!ENTITY/i.test(page.body) || XMLValidator.validate(page.body) !== true)
        throw new Error('Invalid RSS feed')
      const parsed = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: '',
        processEntities: true,
        parseTagValue: false,
        parseAttributeValue: false
      }).parse(page.body)
      const rss = record(record(parsed).rss)
      const channel = record(rss.channel)
      if (rss.version !== '2.0' || !text(channel.title)) throw new Error('Expected an RSS 2.0 feed')
      kind = 'rss'
      sourceName = plainText(channel.title)
      entries = array(channel.item)
      next = null
    }
    for (const value of entries) {
      try {
        const entry = record(value)
        const candidates = json
          ? [
              installTarget(entry.external_url, page.url),
              installTarget(entry.url, page.url),
              ...array(entry.attachments).map((a) => installTarget(record(a).url, page.url, text(record(a).mime_type)))
            ]
          : [
              installTarget(entry.link, page.url),
              ...array(entry.enclosure).map((a) => installTarget(record(a).url, page.url, text(record(a).type)))
            ]
        const target = candidates.find((candidate) => candidate !== null)
        if (!target) {
          skipped++
          continue
        }
        const name =
          plainText(entry.title) ||
          decodeURIComponent(new URL(target.url).pathname.split('/').filter(Boolean).at(-1) ?? '')
        const item = skillItem(source.id, target.url, target.kind, name)
        item.description = localized(
          plainText(json ? (entry.summary ?? entry.content_text ?? entry.content_html) : entry.description)
        )
        item.longDescription = localized(
          plainText(json ? (entry.content_text ?? entry.content_html) : (entry['content:encoded'] ?? entry.description))
        )
        item.author = plainText(
          json ? record(array(entry.authors)[0] ?? entry.author).name : (entry.author ?? entry['dc:creator'])
        )
        item.tags = (json ? array(entry.tags) : array(entry.category)).map(plainText).filter(Boolean)
        item.releaseDate = text(json ? (entry.date_modified ?? entry.date_published) : entry.pubDate)
        items.set(item.id, item)
      } catch {
        skipped++
      }
    }
  }
  return {
    source: { ...source, name: sourceName, kind: kind! },
    items: [...items.values()],
    fetchedAt: Date.now(),
    skipped
  }
}
