import { app, BrowserWindow, net } from 'electron'
import * as z from 'zod'

import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { getAppEdition } from '@main/utils/appEdition'

const logger = loggerService.withContext('OfficialAnnouncementService')
const SCHEDULE_ID = 'official-announcement:poll'
const CHECK_INTERVAL_MS = 30 * 60 * 1000
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000
const PAGE_SIZE = 100
const AnnouncementPageSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().min(1),
        title: z.string().min(1),
        content: z.string().min(1),
        platforms: z.array(z.enum(['desktop', 'android', 'ios'])).min(1),
        products: z.array(z.enum(['global', 'cn', 'enterprise'])).min(1),
        published_at: z.iso.datetime()
      })
    )
    .max(PAGE_SIZE),
  total: z.number().int().nonnegative()
})

@Injectable('OfficialAnnouncementService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['NotificationService', 'SchedulerService'])
export class OfficialAnnouncementService extends BaseService {
  private ready = false
  private controller?: AbortController
  private runningController?: AbortController
  private removeFocusListeners?: () => void

  protected onInit(): void {
    const preferences = application.get('PreferenceService')
    this.registerDisposable(() => this.cancel())
    this.registerDisposable(
      preferences.subscribeChange('app.notification.center.official.enabled', () => this.configure())
    )
    this.configure()
  }

  protected onAllReady(): void {
    this.ready = true
    this.configure()
  }

  private cancel(): void {
    this.removeFocusListeners?.()
    this.removeFocusListeners = undefined
    this.controller?.abort()
    this.controller = undefined
    application.get('SchedulerService').unregister(SCHEDULE_ID)
  }

  private configure(): void {
    this.cancel()
    if (!this.ready || !application.get('PreferenceService').get('app.notification.center.official.enabled')) return
    this.controller = new AbortController()
    this.observeFocus(this.controller)
    this.schedule(this.controller, 5000)
  }

  private observeFocus(controller: AbortController): void {
    let foreground = BrowserWindow.getFocusedWindow() !== null
    let hasFocused = foreground
    let blurTimer: ReturnType<typeof setTimeout> | undefined
    const onBlur = () => {
      if (blurTimer) clearTimeout(blurTimer)
      blurTimer = setTimeout(() => {
        blurTimer = undefined
        foreground = BrowserWindow.getFocusedWindow() !== null
      }, 0)
    }
    const onFocus = () => {
      if (blurTimer) clearTimeout(blurTimer)
      blurTimer = undefined
      const returned = hasFocused && !foreground
      foreground = true
      hasFocused = true
      if (returned) void this.check(controller)
    }
    app.on('browser-window-blur', onBlur)
    app.on('browser-window-focus', onFocus)
    this.removeFocusListeners = () => {
      if (blurTimer) clearTimeout(blurTimer)
      app.removeListener('browser-window-blur', onBlur)
      app.removeListener('browser-window-focus', onFocus)
    }
  }

  private schedule(controller: AbortController, delayMs: number): void {
    if (controller.signal.aborted) return
    application
      .get('SchedulerService')
      .registerSchedule(SCHEDULE_ID, { kind: 'once', at: Date.now() + delayMs }, () => this.check(controller))
  }

  private async check(controller: AbortController): Promise<void> {
    if (controller.signal.aborted || this.runningController === controller) return
    this.runningController = controller
    application.get('SchedulerService').unregister(SCHEDULE_ID)
    const cutoff = Date.now() - RETENTION_MS
    try {
      const url = new URL('https://api.cherry-ai.com/api/announcements')
      url.search = new URLSearchParams({
        platform: 'desktop',
        product: getAppEdition(),
        limit: String(PAGE_SIZE)
      }).toString()
      let offset = 0
      while (!controller.signal.aborted) {
        url.searchParams.set('offset', String(offset))
        const response = await net.fetch(url.toString(), {
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)])
        })
        if (!response.ok) throw new Error(`Announcement request failed with HTTP ${response.status}`)
        const page = AnnouncementPageSchema.parse(await response.json())
        for (const announcement of page.items) {
          controller.signal.throwIfAborted()
          const createdAt = Date.parse(announcement.published_at)
          if (createdAt <= cutoff) return
          const consumed = await application.get('NotificationService').publish({
            eventKey: `announcement:api:${JSON.stringify([announcement.id, announcement.published_at])}`,
            category: 'official',
            kind: 'announcement',
            title: announcement.title,
            message: Array.from(announcement.content.replace(/\s+/gu, ' ').trim()).slice(0, 240).join(''),
            createdAt,
            target: { kind: 'announcement', content: announcement.content }
          })
          if (!consumed) throw new Error('Failed to persist announcement')
        }
        offset += page.items.length
        if (page.items.length === 0 || offset >= page.total) return
      }
    } catch (error) {
      if (!controller.signal.aborted) logger.warn('Failed to check official announcements', { error })
    } finally {
      if (this.runningController === controller) this.runningController = undefined
      this.schedule(controller, CHECK_INTERVAL_MS)
    }
  }
}
