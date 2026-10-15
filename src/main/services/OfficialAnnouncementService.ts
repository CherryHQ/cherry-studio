import { eq } from 'drizzle-orm'
import { net } from 'electron'
import { XMLParser, XMLValidator } from 'fast-xml-parser'
import TurndownService from 'turndown'
import * as z from 'zod'

import { application } from '@application'
import { appStateTable } from '@data/db/schemas/appState'
import { loggerService } from '@logger'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { applyTableRules } from '@main/utils/htmlToMarkdown'
import { stripMarkdownFormatting } from '@main/utils/searchSnippet'
import { AnnouncementUrlSchema } from '@shared/data/types/notification'

const logger = loggerService.withContext('OfficialAnnouncementService')
const FEED_URL = 'https://github.com/CherryHQ/cherry-studio/discussions/categories/announcements.atom'
const SCHEDULE_ID = 'official-announcement:check'
const SUBSCRIPTION_KEY = 'officialAnnouncement:subscription'
const ETAG_KEY = 'notification.announcement.etag'
const MAX_BYTES = 1024 * 1024
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000

const AtomFeedSchema = z.object({
  feed: z.object({ '@_xmlns': z.literal('http://www.w3.org/2005/Atom'), entry: z.array(z.unknown()).default([]) })
})
const AtomEntrySchema = z.object({
  id: z.string().min(1).max(512),
  title: z.string().trim().min(1).max(1000),
  published: z.iso.datetime({ offset: true }),
  link: z.array(z.object({ '@_href': z.string(), '@_rel': z.string().optional() })),
  content: z.object({ '@_type': z.literal('html'), '#text': z.string().min(1) })
})

async function readFeed(response: Response, signal: AbortSignal): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) throw new Error('Announcement feed has no body')
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    if (Number(response.headers.get('content-length')) > MAX_BYTES) throw new Error('Announcement feed is too large')
    while (true) {
      const { done, value } = await reader.read()
      signal.throwIfAborted()
      if (done) return Buffer.concat(chunks).toString('utf8')
      size += value.byteLength
      if (size > MAX_BYTES) throw new Error('Announcement feed is too large')
      chunks.push(value)
    }
  } finally {
    try {
      await reader.cancel()
    } finally {
      reader.releaseLock()
    }
  }
}

@Injectable('OfficialAnnouncementService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['NotificationService', 'SchedulerService'])
export class OfficialAnnouncementService extends BaseService {
  private generation = 0
  private enabled = false
  private since = 0
  private stopped = false
  private controller?: AbortController
  private pending?: Promise<void>

  protected onInit(): void {
    this.stopped = false
    const preferences = application.get('PreferenceService')
    this.registerDisposable(() => {
      this.stopped = true
      this.cancel()
    })
    this.registerDisposable(
      preferences.subscribeChange('app.notification.center.official.enabled', (enabled) => this.configure(enabled))
    )
    this.configure(preferences.get('app.notification.center.official.enabled'))
  }

  private configure(enabled: boolean): void {
    this.cancel()
    const previous = this.readState(SUBSCRIPTION_KEY) as { enabled: boolean; since: number } | undefined
    this.enabled = enabled
    this.since = !previous || (enabled && !previous.enabled) ? Date.now() : previous.since
    if (!previous || previous.enabled !== enabled) {
      this.writeState(SUBSCRIPTION_KEY, { enabled, since: this.since })
      application.get('CacheService').setPersist(ETAG_KEY, null)
    }
    if (enabled) this.schedule(5000)
  }

  private cancel(): void {
    this.generation++
    this.controller?.abort()
    this.controller = undefined
    this.pending = undefined
    application.get('SchedulerService').unregister(SCHEDULE_ID)
  }

  private schedule(delay: number): void {
    application
      .get('SchedulerService')
      .registerSchedule(SCHEDULE_ID, { kind: 'once', at: Date.now() + delay }, () => this.check())
  }

  public check(): Promise<void> {
    if (this.stopped || !this.enabled) return Promise.resolve()
    if (this.pending) return this.pending
    const generation = this.generation
    this.controller = new AbortController()
    const signal = AbortSignal.any([this.controller.signal, AbortSignal.timeout(10_000)])
    this.pending = this.fetchAnnouncements(signal)
      .catch((error) => {
        if (generation === this.generation) logger.warn('Failed to check official announcements', error as Error)
      })
      .finally(() => {
        if (generation !== this.generation) return
        this.pending = undefined
        this.controller = undefined
        this.schedule(4 * 60 * 60 * 1000)
      })
    return this.pending
  }

  private async fetchAnnouncements(signal: AbortSignal): Promise<void> {
    const etag = application.get('CacheService').getPersist(ETAG_KEY)
    const response = await net.fetch(FEED_URL, {
      headers: { Accept: 'application/atom+xml', ...(etag ? { 'If-None-Match': etag } : {}) },
      credentials: 'omit',
      redirect: 'error',
      signal
    })
    if (signal.aborted || !response.ok) {
      await response.body?.cancel()
      signal.throwIfAborted()
      if (response.status === 304 && etag) return
      throw new Error(`Announcement feed returned HTTP ${response.status}`)
    }
    const source = await readFeed(response, signal)
    signal.throwIfAborted()
    if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(source) || XMLValidator.validate(source) !== true) {
      throw new Error('Invalid announcement XML')
    }
    const parser = new XMLParser({
      ignoreAttributes: false,
      parseTagValue: false,
      isArray: (name) => name === 'entry' || name === 'link'
    })
    const { feed } = AtomFeedSchema.parse(parser.parse(source))
    const turndown = applyTableRules(new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' }))
    turndown.remove((node) =>
      ['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'FORM', 'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT', 'SVG'].includes(
        node.nodeName
      )
    )
    for (const raw of feed.entry) {
      const parsed = AtomEntrySchema.safeParse(raw)
      if (!parsed.success) continue
      const entry = parsed.data
      const url = AnnouncementUrlSchema.safeParse(
        entry.link.find((link) => !link['@_rel'] || link['@_rel'] === 'alternate')?.['@_href']
      )
      if (!url.success) continue
      const consumedKey = `officialAnnouncement:consumed:${entry.id}`
      if (this.readState(consumedKey)) continue
      const published = Date.parse(entry.published)
      if (published > this.since && published > Date.now() - RETENTION_MS) {
        const content = turndown.turndown(entry.content['#text']).trim()
        if (!content || Buffer.byteLength(content, 'utf8') > MAX_BYTES)
          throw new Error('Invalid announcement content size')
        const saved = await application.get('NotificationService').publish({
          eventKey: `announcement:R_kgDOL_2xwg:${entry.id}`,
          category: 'official',
          kind: 'announcement',
          title: entry.title,
          message: stripMarkdownFormatting(content).replace(/\s+/g, ' ').trim().slice(0, 240),
          createdAt: published,
          target: { kind: 'announcement', url: url.data, content }
        })
        signal.throwIfAborted()
        if (!saved) throw new Error('Announcement could not be saved')
      }
      this.writeState(consumedKey, true)
    }
    signal.throwIfAborted()
    application.get('CacheService').setPersist(ETAG_KEY, response.headers.get('etag'))
  }

  private readState(key: string): unknown {
    return application.get('DbService').getDb().select().from(appStateTable).where(eq(appStateTable.key, key)).get()
      ?.value
  }

  private writeState(key: string, value: unknown): void {
    application
      .get('DbService')
      .getDb()
      .insert(appStateTable)
      .values({ key, value })
      .onConflictDoUpdate({ target: appStateTable.key, set: { value, updatedAt: Date.now() } })
      .run()
  }
}
