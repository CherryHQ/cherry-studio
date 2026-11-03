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
  notificationErrorFrameSchema,
  notificationReadySchema
} from './contracts'

const logger = loggerService.withContext('CherryCloudNotificationService')

const STREAM_PATH = '/api/v1/notifications/stream'
const PAGE_PATH = '/api/v1/notifications'
const PAGE_LIMIT = 50
const RETRY_MIN_MS = 1_000
const RETRY_MAX_MS = 60_000
const SEEN_ID_LIMIT = 500
// The server sends a heartbeat every 15 seconds; three missed ones mean a dead connection.
const IDLE_TIMEOUT_MS = 45_000

/** The backend has the notification endpoints switched off; focus refresh stays the only path. */
class NotificationsUnavailableError extends Error {}
/** The stored cursor is no longer valid; the next connection starts from a new baseline. */
class CursorRejectedError extends Error {}
/** The server is rate limiting or unavailable and asked the client to wait before reconnecting. */
class RetryLaterError extends Error {
  constructor(
    status: number,
    readonly retryAfterMs: number
  ) {
    super(`Cherry Cloud notification request failed (${status})`)
  }
}

const isCursorRejection = (code: string | null) => code === 'INVALID_CURSOR' || code === 'RESYNC_REQUIRED'

function retryAfterMs(response: Response): number {
  const header = response.headers.get('Retry-After')
  if (!header) return 0
  const seconds = Number(header)
  const ms = Number.isFinite(seconds) ? seconds * 1_000 : Date.parse(header) - Date.now()
  return Number.isFinite(ms) ? Math.min(Math.max(ms, 0), RETRY_MAX_MS) : 0
}

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
      let serverDelayMs = 0
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
        if (error instanceof RetryLaterError) serverDelayMs = error.retryAfterMs
        logger.warn('Cherry Cloud notification stream interrupted', {
          reason: error instanceof Error ? error.message : String(error)
        })
      }
      await wait(Math.max(retryMs * (0.5 + Math.random()), serverDelayMs), signal)
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
      const unseen = page.items.filter((notification) => !this.seenIds.has(notification.id))
      if (unseen.some(asksForRefresh)) await this.refreshAccount(signal)
      unseen.forEach((notification) => this.remember(notification.id))
      after = page.next_cursor
      this.saveCursor(accountId, after)
      if (!page.has_more) return
    }
  }

  private async listen(accountId: string, signal: AbortSignal, onReady: () => void): Promise<void> {
    const connection = new AbortController()
    const close = () => connection.abort()
    signal.addEventListener('abort', close, { once: true })
    // Heartbeats are SSE comments the parser drops, so liveness is measured on the raw text; a silent
    // connection is failed here because aborting the request does not always end its body.
    let idleTimer: ReturnType<typeof setTimeout> | undefined
    let fail: (error: Error) => void = () => undefined
    const watch = () => {
      clearTimeout(idleTimer)
      idleTimer = setTimeout(() => {
        fail(new Error('Cherry Cloud notification stream stopped sending heartbeats'))
        close()
      }, IDLE_TIMEOUT_MS)
    }
    const heartbeat = new TransformStream<string, string>({
      start(controller) {
        fail = (error) => controller.error(error)
        watch()
      },
      transform(chunk, controller) {
        watch()
        controller.enqueue(chunk)
      }
    })
    try {
      await this.readStream(accountId, connection.signal, heartbeat, onReady)
    } finally {
      clearTimeout(idleTimer)
      signal.removeEventListener('abort', close)
    }
  }

  private async readStream(
    accountId: string,
    signal: AbortSignal,
    heartbeat: TransformStream<string, string>,
    onReady: () => void
  ): Promise<void> {
    const cursor = this.storedCursor(accountId)
    const query = cursor ? `?${new URLSearchParams({ after: cursor })}` : ''
    const response = await this.request(`${STREAM_PATH}${query}`, signal, { Accept: 'text/event-stream' })
    if (!response.body) throw new Error('Cherry Cloud notification stream has no body')

    const events = response.body
      .pipeThrough(new TextDecoderStream())
      .pipeThrough(heartbeat)
      .pipeThrough(new EventSourceParserStream())
    for await (const event of events) {
      if (signal.aborted) return
      if (event.event === 'error') {
        // Error frames end the connection and never advance the cursor.
        const code = notificationErrorFrameSchema.safeParse(JSON.parse(event.data)).data?.code ?? null
        if (isCursorRejection(code)) throw new CursorRejectedError()
        throw new Error(`Cherry Cloud notification stream error (${code ?? 'unknown'})`)
      } else if (event.event === 'ready') {
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
    if (response.status === 429 || response.status === 503) {
      throw new RetryLaterError(response.status, retryAfterMs(response))
    }
    // 410 always means the cursor's position is gone; a 400 only when it names the cursor.
    if (response.status === 410 || (response.status === 400 && isCursorRejection(await errorCode(response)))) {
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
