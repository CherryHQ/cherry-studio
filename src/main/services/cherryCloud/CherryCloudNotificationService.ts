import { EventSourceParserStream } from '@ai-sdk/provider-utils'

import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, Conditional, DependsOn, Injectable, Phase, ServicePhase, when } from '@main/core/lifecycle'
import { t } from '@main/i18n'
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
// One catch-up page, body included; a stalled transport must not keep the stream from reconnecting.
const PAGE_TIMEOUT_MS = 30_000
// The endpoints can go live while the app runs, so a 404 is rechecked on this slow cadence.
const UNAVAILABLE_RETRY_MS = 5 * 60_000

/** The backend has the notification endpoints switched off; focus refresh covers until they return. */
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

function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason)
    if (signal.aborted) {
      void promise.catch(() => undefined)
      return abort()
    }
    signal.addEventListener('abort', abort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
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

// For a renewal reminder the protocol sets expires_at to the end of the current paid period.
function localDate(value: string): string | null {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** Product copy that tells the user what to do next; types without one keep the server text. */
function productCopy(notification: CloudNotification): string | null {
  switch (notification.type) {
    case 'subscription.activated':
      return t('notification.subscription.activated_message')
    case 'subscription.expired':
      return t('notification.subscription.expired_message')
    case 'subscription.renewed':
      return t('notification.subscription.renewed_message')
    case 'subscription.auto_renew_enabled':
      return t('notification.subscription.auto_renew_enabled_message')
    case 'subscription.entitlement_revoked':
      return t('notification.subscription.entitlement_revoked_message')
    case 'subscription.entitlement_restored':
      return t('notification.subscription.entitlement_restored_message')
  }
  const periodEnd = notification.type === 'subscription.renewal_reminder' && notification.expires_at
  const date = periodEnd ? localDate(periodEnd) : null
  return date ? t('notification.subscription.renewal_reminder_message', { date }) : null
}

// The server can emit one event under several ids, so a record is keyed by what happened when it can be.
function eventKeyOf(notification: CloudNotification): string {
  const { type, subscription_id: subscriptionId, occurred_at: occurredAt } = notification
  return type && subscriptionId && occurredAt
    ? `cherry-cloud:${type}:${subscriptionId}:${occurredAt}`
    : `cherry-cloud:${notification.id}`
}

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
 * Keeps the China-edition subscription notification stream open for the signed-in account.
 * Entitlement changes refresh account facts and publish a typed receipt to renderer consumers.
 * Notifications land in the notification center: live ones are announced, caught-up history is only recorded.
 */
@Injectable('CherryCloudNotificationService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['CherryCloudService', 'NotificationService'])
@Conditional(when(() => getAppEdition() === 'cn', 'China edition'))
export class CherryCloudNotificationService extends BaseService {
  private connection: { accountId: string; scopeId: string; controller: AbortController } | null = null
  private readonly seenIds = new Set<string>()
  private active = false

  protected async onInit(): Promise<void> {
    const cloud = application.get('CherryCloudService')
    this.registerDisposable(cloud.onStatusChanged((status) => this.follow(status)))
    this.registerDisposable(() => this.disconnect())
    this.follow(await cloud.getStatus())
  }

  private follow(status: CherryCloudStatus): void {
    const accountId = status.phase === 'signed-in' ? status.accountId : null
    if (this.connection?.accountId === accountId && this.connection?.scopeId === status.scopeId) return
    this.disconnect()
    if (!accountId) return
    const controller = new AbortController()
    this.connection = { accountId, scopeId: status.scopeId, controller }
    this.seenIds.clear()
    void this.run(accountId, status.scopeId, controller.signal)
  }

  /**
   * Whether this account's stream has reached `ready`, so server notifications announce changes. A
   * transient disconnect keeps it set, since the catch-up after it must stay silent.
   */
  public isActive(): boolean {
    return this.active
  }

  private disconnect(): void {
    this.connection?.controller.abort()
    this.connection = null
    this.active = false
  }

  private async run(accountId: string, scopeId: string, signal: AbortSignal): Promise<void> {
    let retryMs = RETRY_MIN_MS
    let reportedUnavailable = false
    while (!signal.aborted) {
      let serverDelayMs = 0
      try {
        const cursor = this.storedCursor(accountId)
        if (cursor) await this.catchUp(accountId, scopeId, cursor, signal)
        await this.listen(accountId, scopeId, signal, () => (retryMs = RETRY_MIN_MS))
      } catch (error) {
        if (signal.aborted) return
        if (error instanceof NotificationsUnavailableError) {
          this.active = false
          if (!reportedUnavailable) logger.info('Cherry Cloud notifications unavailable; checking again later')
          reportedUnavailable = true
          await wait(UNAVAILABLE_RETRY_MS, signal)
          continue
        }
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
  private async catchUp(accountId: string, scopeId: string, cursor: string, signal: AbortSignal): Promise<void> {
    let after = cursor
    for (;;) {
      const query = new URLSearchParams({ after, limit: String(PAGE_LIMIT) })
      const deadline = AbortSignal.any([signal, AbortSignal.timeout(PAGE_TIMEOUT_MS)])
      const page = await untilAborted(
        this.request(`${PAGE_PATH}?${query}`, deadline).then(async (response) =>
          cloudNotificationPageSchema.parse(await response.json())
        ),
        deadline
      )
      const unseen = page.items.filter((notification) => !this.seenIds.has(notification.id))
      if (unseen.some(asksForRefresh)) await this.refreshAccount(scopeId, signal)
      signal.throwIfAborted()
      unseen.forEach((notification) => this.settle(notification, false))
      after = page.next_cursor
      this.saveCursor(accountId, after)
      if (!page.has_more) return
    }
  }

  private async listen(accountId: string, scopeId: string, signal: AbortSignal, onReady: () => void): Promise<void> {
    signal.throwIfAborted()
    const connection = new AbortController()
    let fail: (error: Error) => void = () => undefined
    const close = () => {
      fail(new DOMException('Cherry Cloud notification connection cancelled', 'AbortError'))
      connection.abort()
    }
    signal.addEventListener('abort', close, { once: true })
    // Heartbeats are SSE comments the parser drops, so liveness is measured on the raw text; a silent
    // connection is failed here because aborting the request does not always end its body.
    let idleTimer: ReturnType<typeof setTimeout> | undefined
    const watch = () => {
      clearTimeout(idleTimer)
      idleTimer = setTimeout(() => {
        fail(new Error('Cherry Cloud notification stream stopped sending heartbeats'))
        connection.abort()
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
      await this.readStream(accountId, scopeId, connection.signal, heartbeat, onReady)
    } finally {
      clearTimeout(idleTimer)
      signal.removeEventListener('abort', close)
    }
  }

  private async readStream(
    accountId: string,
    scopeId: string,
    signal: AbortSignal,
    heartbeat: TransformStream<string, string>,
    onReady: () => void
  ): Promise<void> {
    const cursor = this.storedCursor(accountId)
    const query = cursor ? `?${new URLSearchParams({ after: cursor })}` : ''
    const response = await untilAborted(
      this.request(`${STREAM_PATH}${query}`, signal, { Accept: 'text/event-stream' }),
      signal
    )
    if (!response.body) throw new Error('Cherry Cloud notification stream has no body')

    const events = response.body
      .pipeThrough(new TextDecoderStream())
      .pipeThrough(heartbeat)
      .pipeThrough(new EventSourceParserStream())
    let live = false
    for await (const event of events) {
      if (signal.aborted) return
      if (event.event === 'error') {
        // Error frames end the connection and never advance the cursor.
        const code = notificationErrorFrameSchema.safeParse(JSON.parse(event.data)).data?.code ?? null
        if (isCursorRejection(code)) throw new CursorRejectedError()
        throw new Error(`Cherry Cloud notification stream error (${code ?? 'unknown'})`)
      } else if (event.event === 'ready') {
        const ready = notificationReadySchema.parse(JSON.parse(event.data))
        await this.refreshAccount(scopeId, signal)
        signal.throwIfAborted()
        this.saveCursor(accountId, ready.cursor)
        onReady()
        live = true
        this.active = true
      } else if (event.event === 'notification') {
        const notification = cloudNotificationSchema.parse(JSON.parse(event.data))
        if (!this.seenIds.has(notification.id)) {
          if (asksForRefresh(notification)) await this.refreshAccount(scopeId, signal)
          signal.throwIfAborted()
          this.settle(notification, live)
        }
        signal.throwIfAborted()
        this.saveCursor(accountId, notification.cursor)
      }
    }
    throw new Error('Cherry Cloud notification stream ended')
  }

  // Settled only after its refresh succeeded, so a failed notification is retried on catch-up.
  private settle(notification: CloudNotification, live: boolean): void {
    const now = Date.now()
    const occurredAt = notification.occurred_at ? Date.parse(notification.occurred_at) : Number.NaN
    const record = {
      eventKey: eventKeyOf(notification),
      category: 'usage' as const,
      kind: 'cherry-cloud-subscription',
      createdAt: Number.isFinite(occurredAt) ? occurredAt : now,
      title: notification.title || t('notification.subscription.updated_title'),
      message: productCopy(notification) ?? (notification.body || t('notification.subscription.updated_message')),
      target: { kind: 'settings' as const, tab: 'profile' as const }
    }
    const prominent = !notification.expires_at || !(Date.parse(notification.expires_at) <= now)
    // History and notifications past their presentation deadline are kept, already read, without a pop-up.
    const notifications = application.get('NotificationService')
    if (live && prominent) void notifications.publish(record)
    else void notifications.publish({ ...record, readAt: now }, { recordOnly: true })
    this.seenIds.add(notification.id)
    if (this.seenIds.size <= SEEN_ID_LIMIT) return
    const [oldest] = this.seenIds
    this.seenIds.delete(oldest)
  }

  private async refreshAccount(scopeId: string, signal: AbortSignal): Promise<void> {
    const result = await application
      .get('CherryCloudService')
      .refreshAccount({ scopeId, reason: 'notification', signal })
    signal.throwIfAborted()
    if (result.outcome !== 'refreshed') throw new Error(`Cherry Cloud notification refresh ${result.outcome}`)
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

  // Cursors are account-scoped, so switching accounts keeps the other account's catch-up position.
  private storedCursor(accountId: string): string | null {
    return application.get('CacheService').getPersist('cherry_cloud.notification_cursors')[accountId] ?? null
  }

  private saveCursor(accountId: string, cursor: string | null): void {
    const cache = application.get('CacheService')
    const cursors = { ...cache.getPersist('cherry_cloud.notification_cursors') }
    if (cursor) cursors[accountId] = cursor
    else delete cursors[accountId]
    cache.setPersist('cherry_cloud.notification_cursors', cursors)
  }
}
