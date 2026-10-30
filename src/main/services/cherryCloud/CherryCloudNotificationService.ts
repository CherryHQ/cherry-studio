import { EventSourceParserStream } from '@ai-sdk/provider-utils'

import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, Conditional, DependsOn, Injectable, Phase, ServicePhase, when } from '@main/core/lifecycle'
import { getAppEdition } from '@main/utils/appEdition'
import type { CherryCloudStatus } from '@shared/ipc/schemas/cherryCloud'

import {
  type CloudNotification,
  cloudNotificationPageSchema,
  cloudNotificationSchema,
  notificationReadySchema
} from './contracts'

const logger = loggerService.withContext('CherryCloudNotificationService')

const STREAM_PATH = '/api/v1/notifications/stream'
const PAGE_PATH = '/api/v1/notifications'
const PAGE_LIMIT = 50
const RETRY_MIN_MS = 1_000
const RETRY_MAX_MS = 60_000
const SEEN_ID_LIMIT = 500

/** The backend has the notification endpoints switched off; focus refresh stays the only path. */
class NotificationsUnavailableError extends Error {}
/** The stored cursor is no longer valid; the next connection starts from a new baseline. */
class CursorRejectedError extends Error {}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms)
    signal.addEventListener('abort', done, { once: true })
    function done() {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
  })
}

const asksForRefresh = (notification: CloudNotification) => (notification.refresh?.length ?? 0) > 0

async function errorCode(response: Response): Promise<string | null> {
  const header = response.headers.get('Cherry-Error-Code')
  if (header) return header
  try {
    const body = (await response.json()) as { error?: { code?: unknown } }
    return typeof body.error?.code === 'string' ? body.error.code : null
  } catch {
    return null
  }
}

/**
 * Keeps the China-edition subscription notification stream open for the signed-in account. Every
 * notification that changes entitlements refreshes the account and models, after which the renderer
 * is told to refetch plans and model availability.
 */
@Injectable('CherryCloudNotificationService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['CherryCloudService'])
@Conditional(when(() => getAppEdition() === 'cn', 'China edition'))
export class CherryCloudNotificationService extends BaseService {
  private connection: { accountId: string; controller: AbortController } | null = null
  private readonly seenIds = new Set<string>()

  protected async onInit(): Promise<void> {
    const cloud = application.get('CherryCloudService')
    this.registerDisposable(cloud.onStatusChanged((status) => this.follow(status)))
    this.registerDisposable(() => this.disconnect())
    this.follow(await cloud.getStatus())
  }

  private follow(status: CherryCloudStatus): void {
    const accountId = status.phase === 'signed-in' ? status.accountId : null
    if (this.connection?.accountId === accountId) return
    this.disconnect()
    if (!accountId) return
    const controller = new AbortController()
    this.connection = { accountId, controller }
    this.seenIds.clear()
    void this.run(accountId, controller.signal)
  }

  private disconnect(): void {
    this.connection?.controller.abort()
    this.connection = null
  }

  private async run(accountId: string, signal: AbortSignal): Promise<void> {
    let retryMs = RETRY_MIN_MS
    while (!signal.aborted) {
      try {
        const cursor = this.storedCursor(accountId)
        if (cursor) await this.catchUp(accountId, cursor, signal)
        await this.listen(accountId, signal, () => (retryMs = RETRY_MIN_MS))
      } catch (error) {
        if (signal.aborted) return
        if (error instanceof NotificationsUnavailableError) return
        if (error instanceof CursorRejectedError) {
          this.saveCursor(accountId, null)
          continue
        }
        logger.warn('Cherry Cloud notification stream interrupted', {
          reason: error instanceof Error ? error.message : String(error)
        })
      }
      await wait(retryMs * (0.5 + Math.random()), signal)
      retryMs = Math.min(retryMs * 2, RETRY_MAX_MS)
    }
  }

  /** Replays what arrived while disconnected; history refreshes entitlements but is never announced. */
  private async catchUp(accountId: string, cursor: string, signal: AbortSignal): Promise<void> {
    let after = cursor
    for (;;) {
      const query = new URLSearchParams({ after, limit: String(PAGE_LIMIT) })
      const response = await this.request(`${PAGE_PATH}?${query}`, signal)
      const page = cloudNotificationPageSchema.parse(await response.json())
      const unseen = page.notifications.filter((notification) => !this.seenIds.has(notification.id))
      if (unseen.some(asksForRefresh)) await this.refreshAccount(signal)
      unseen.forEach((notification) => this.remember(notification.id))
      after = page.next_cursor ?? page.notifications.at(-1)?.cursor ?? after
      this.saveCursor(accountId, after)
      if (!page.next_cursor || page.notifications.length === 0) return
    }
  }

  private async listen(accountId: string, signal: AbortSignal, onReady: () => void): Promise<void> {
    const cursor = this.storedCursor(accountId)
    const query = cursor ? `?${new URLSearchParams({ after: cursor })}` : ''
    const response = await this.request(`${STREAM_PATH}${query}`, signal, { Accept: 'text/event-stream' })
    if (!response.body) throw new Error('Cherry Cloud notification stream has no body')

    const events = response.body.pipeThrough(new TextDecoderStream()).pipeThrough(new EventSourceParserStream())
    for await (const event of events) {
      if (signal.aborted) return
      if (event.event === 'ready') {
        this.saveCursor(accountId, notificationReadySchema.parse(JSON.parse(event.data)).cursor)
        onReady()
        await this.refreshAccount(signal)
      } else if (event.event === 'notification') {
        const notification = cloudNotificationSchema.parse(JSON.parse(event.data))
        if (!this.seenIds.has(notification.id)) {
          if (asksForRefresh(notification)) await this.refreshAccount(signal)
          this.remember(notification.id)
        }
        this.saveCursor(accountId, notification.cursor)
      }
    }
    throw new Error('Cherry Cloud notification stream ended')
  }

  // Ids are remembered only after their refresh succeeded, so a failed one is retried on catch-up.
  private remember(id: string): void {
    this.seenIds.add(id)
    if (this.seenIds.size <= SEEN_ID_LIMIT) return
    const [oldest] = this.seenIds
    this.seenIds.delete(oldest)
  }

  private async refreshAccount(signal: AbortSignal): Promise<void> {
    await application.get('CherryCloudService').refreshEntitledModels()
    if (!signal.aborted) application.get('IpcApiService').broadcast('cherry_cloud.account_refreshed', undefined)
  }

  private async request(path: string, signal: AbortSignal, headers?: HeadersInit): Promise<Response> {
    // Each call signs anew, so every reconnect and page carries a fresh nonce and device signature.
    const response = await application
      .get('CherryCloudService')
      .authenticatedFetch(path, { method: 'GET', headers, signal })
    if (response.ok) return response
    if (response.status === 404) throw new NotificationsUnavailableError()
    const code = await errorCode(response)
    if (
      (response.status === 400 && code === 'INVALID_CURSOR') ||
      (response.status === 410 && code === 'RESYNC_REQUIRED')
    ) {
      throw new CursorRejectedError()
    }
    throw new Error(`Cherry Cloud notification request failed (${response.status})`)
  }

  private storedCursor(accountId: string): string | null {
    const stored = application.get('CacheService').getPersist('cherry_cloud.notification_cursor')
    return stored?.accountId === accountId ? stored.cursor : null
  }

  private saveCursor(accountId: string, cursor: string | null): void {
    application
      .get('CacheService')
      .setPersist('cherry_cloud.notification_cursor', cursor ? { accountId, cursor } : null)
  }
}
