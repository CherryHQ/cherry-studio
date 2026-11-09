import { MockApplicationUtils } from '@test-mocks/main/application'
import { MockMainCacheServiceUtils } from '@test-mocks/main/CacheService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import type * as LifecycleModule from '@main/core/lifecycle'
import { getConditions } from '@main/core/lifecycle/decorators'
import type { ConditionContext } from '@main/core/lifecycle/types'
import { t } from '@main/i18n'
import type { CherryCloudStatus } from '@shared/ipc/schemas/cherryCloud'

const edition = vi.hoisted(() => ({ current: 'cn' as 'cn' | 'global' }))
vi.mock('@main/utils/appEdition', () => ({ getAppEdition: () => edition.current }))

const { createRecord, publish } = vi.hoisted(() => ({
  createRecord: vi.fn<(input: unknown) => unknown>(),
  publish: vi.fn<(input: unknown) => Promise<boolean>>(async () => true)
}))
vi.mock('@data/services/NotificationRecordService', () => ({ notificationRecordService: { create: createRecord } }))

vi.mock('@main/core/lifecycle', async (importOriginal) => {
  const actual = await importOriginal<typeof LifecycleModule>()
  class MockBaseService {
    protected readonly _disposables: Array<{ dispose: () => void } | (() => void)> = []
    protected registerDisposable<T extends { dispose: () => void } | (() => void)>(disposable: T): T {
      this._disposables.push(disposable)
      return disposable
    }
  }
  return { ...actual, BaseService: MockBaseService }
})

const { CherryCloudNotificationService } = await import('../CherryCloudNotificationService')

type Reply = Response | (() => Response)

const signedIn = (accountId: string): CherryCloudStatus => ({
  phase: 'signed-in',
  accountId,
  displayName: null,
  scopeId: accountId,
  revision: 1
})
const signedOut: CherryCloudStatus = {
  phase: 'signed-out',
  accountId: null,
  displayName: null,
  scopeId: 'out',
  revision: 2
}

/** An open SSE response whose events the test pushes; it never ends on its own. */
function eventStream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const body = new ReadableStream<Uint8Array>({ start: (c) => void (controller = c) })
  return {
    response: new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }),
    send(event: string, data: unknown) {
      controller.enqueue(new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
    },
    heartbeat() {
      controller.enqueue(new TextEncoder().encode(': heartbeat\n\n'))
    }
  }
}

const jsonError = (status: number, code: string) =>
  new Response(JSON.stringify({ type: 'error', error: { code } }), { status })
const page = (items: unknown[], nextCursor: string, hasMore = false) =>
  new Response(JSON.stringify({ items, next_cursor: nextCursor, has_more: hasMore }))
const notification = (id: string, cursor: string, refresh: string[] = ['account', 'models']) => ({
  id,
  cursor,
  refresh
})

let status: CherryCloudStatus
let statusListener: ((status: CherryCloudStatus) => void) | null
let routes: Map<string, Reply[]>
const authenticatedFetch = vi.fn<(path: string, init?: RequestInit) => Promise<Response>>(async (path) => {
  const reply = routes.get(path.split('?')[0])?.shift()
  if (!reply) return new Promise<Response>(() => {})
  return typeof reply === 'function' ? reply() : reply
})
const refreshAccount = vi.fn(async () => ({ outcome: 'refreshed' }))

const requestedPaths = () => authenticatedFetch.mock.calls.map(([path]) => path)
const refreshesAnnounced = () => refreshAccount.mock.calls.length
const storedCursors = () => application.get('CacheService').getPersist('cherry_cloud.notification_cursors')
const storedCursor = () => storedCursors()['account-1'] ?? null

function reply(path: string, ...replies: Reply[]) {
  routes.set(path, [...(routes.get(path) ?? []), ...replies])
}

async function start() {
  const service = new CherryCloudNotificationService()
  await (service as unknown as { onInit: () => Promise<void> }).onInit()
  return service
}

beforeEach(() => {
  MockMainCacheServiceUtils.resetMocks()
  vi.clearAllMocks()
  status = signedIn('account-1')
  statusListener = null
  routes = new Map()
  MockApplicationUtils.setService('CherryCloudService', {
    getStatus: async () => status,
    onStatusChanged: (listener: (status: CherryCloudStatus) => void) => {
      statusListener = listener
      return { dispose: () => (statusListener = null) }
    },
    authenticatedFetch,
    refreshAccount
  })
  MockApplicationUtils.setService('NotificationService', { publish })
})

afterEach(() => {
  statusListener?.(signedOut)
  MockApplicationUtils.resetServices()
})

describe('CherryCloudNotificationService', () => {
  it.each([
    ['cn', true],
    ['global', false]
  ] as const)('is registered in the %s edition: %s', (appEdition, registered) => {
    edition.current = appEdition
    const conditions = getConditions(CherryCloudNotificationService) ?? []

    expect(conditions.every((condition) => condition.matches({} as ConditionContext))).toBe(registered)
    edition.current = 'cn'
  })

  it('builds a baseline on the first connection and refreshes the account on ready', async () => {
    const stream = eventStream()
    reply('/api/v1/notifications/stream', stream.response)
    await start()

    await vi.waitFor(() => expect(requestedPaths()).toEqual(['/api/v1/notifications/stream']))
    expect(authenticatedFetch.mock.calls[0][1]).toMatchObject({ headers: { Accept: 'text/event-stream' } })
    stream.send('ready', { cursor: 'c-0' })

    await vi.waitFor(() => expect(refreshesAnnounced()).toBe(1))
    expect(refreshAccount).toHaveBeenCalledOnce()
    expect(storedCursor()).toBe('c-0')
  })

  it('refreshes once per notification id and still advances the cursor for duplicates', async () => {
    const stream = eventStream()
    reply('/api/v1/notifications/stream', stream.response)
    await start()
    stream.send('ready', { cursor: 'c-0' })
    await vi.waitFor(() => expect(refreshesAnnounced()).toBe(1))

    stream.send('notification', notification('n-1', 'c-1'))
    stream.send('notification', notification('n-1', 'c-2'))
    stream.send('notification', notification('n-2', 'c-3', []))

    await vi.waitFor(() => expect(storedCursor()).toBe('c-3'))
    expect(refreshAccount).toHaveBeenCalledTimes(2)
    expect(refreshesAnnounced()).toBe(2)
  })

  it('catches up from the stored cursor before reconnecting to the stream', async () => {
    application.get('CacheService').setPersist('cherry_cloud.notification_cursors', { 'account-1': 'c-5' })
    reply(
      '/api/v1/notifications',
      page([notification('n-6', 'c-6'), notification('n-7', 'c-7')], 'c-7', true),
      page([notification('n-8', 'c-8', [])], 'c-8')
    )
    await start()

    await vi.waitFor(() =>
      expect(requestedPaths()).toEqual([
        '/api/v1/notifications?after=c-5&limit=50',
        '/api/v1/notifications?after=c-7&limit=50',
        '/api/v1/notifications/stream?after=c-8'
      ])
    )
    expect(refreshAccount).toHaveBeenCalledOnce()
    expect(storedCursor()).toBe('c-8')
  })

  it.each([
    [400, 'INVALID_CURSOR'],
    [410, 'RESYNC_REQUIRED'],
    [410, 'UNDOCUMENTED']
  ])('rebuilds the baseline when the cursor is rejected with %i %s', async (code, errorCode) => {
    application.get('CacheService').setPersist('cherry_cloud.notification_cursors', { 'account-1': 'stale' })
    reply('/api/v1/notifications', jsonError(code, errorCode))
    await start()

    await vi.waitFor(() =>
      expect(requestedPaths()).toEqual(['/api/v1/notifications?after=stale&limit=50', '/api/v1/notifications/stream'])
    )
    expect(storedCursor()).toBeNull()
  })

  it('rebuilds the baseline when the stream ends with a cursor error frame, without advancing the cursor', async () => {
    application.get('CacheService').setPersist('cherry_cloud.notification_cursors', { 'account-1': 'c-5' })
    reply('/api/v1/notifications', page([], 'c-5'))
    const stream = eventStream()
    reply('/api/v1/notifications/stream', stream.response)
    await start()
    await vi.waitFor(() => expect(requestedPaths()).toContain('/api/v1/notifications/stream?after=c-5'))

    stream.send('error', { code: 'RESYNC_REQUIRED' })

    await vi.waitFor(() => expect(requestedPaths().at(-1)).toBe('/api/v1/notifications/stream'))
    expect(storedCursor()).toBeNull()
  })

  it('waits as long as Retry-After asks before reconnecting', async () => {
    vi.useFakeTimers()
    try {
      reply(
        '/api/v1/notifications/stream',
        new Response(null, { status: 429, headers: { 'Retry-After': '20' } }),
        eventStream().response
      )
      await start()
      await vi.waitFor(() => expect(requestedPaths()).toHaveLength(1))

      await vi.advanceTimersByTimeAsync(19_000)
      expect(requestedPaths()).toHaveLength(1)

      await vi.advanceTimersByTimeAsync(2_000)
      expect(requestedPaths()).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('reconnects when the stream stops sending heartbeats, but not while they arrive', async () => {
    vi.useFakeTimers()
    try {
      const stream = eventStream()
      reply('/api/v1/notifications/stream', stream.response, eventStream().response)
      await start()
      stream.send('ready', { cursor: 'c-0' })
      await vi.waitFor(() => expect(refreshAccount).toHaveBeenCalledOnce())

      for (let elapsed = 0; elapsed < 90_000; elapsed += 15_000) {
        stream.heartbeat()
        await vi.advanceTimersByTimeAsync(15_000)
      }
      expect(requestedPaths()).toHaveLength(1)

      await vi.advanceTimersByTimeAsync(45_000 + 3_000)
      expect(requestedPaths()).toEqual(['/api/v1/notifications/stream', '/api/v1/notifications?after=c-0&limit=50'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('gives up on a stalled catch-up page and reconnects', async () => {
    vi.useFakeTimers()
    const deadline = new AbortController()
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal)
    try {
      application.get('CacheService').setPersist('cherry_cloud.notification_cursors', { 'account-1': 'c-5' })
      await start()
      await vi.waitFor(() => expect(requestedPaths()).toEqual(['/api/v1/notifications?after=c-5&limit=50']))

      deadline.abort(new DOMException('The operation timed out.', 'TimeoutError'))
      await vi.advanceTimersByTimeAsync(2_000)

      expect(requestedPaths().length).toBeGreaterThanOrEqual(2)
    } finally {
      timeout.mockRestore()
      vi.useRealTimers()
    }
  })

  it('connects once the notification endpoints go live after a 404, without fast retries', async () => {
    vi.useFakeTimers()
    try {
      const stream = eventStream()
      reply('/api/v1/notifications/stream', new Response(null, { status: 404 }), stream.response)
      await start()
      await vi.waitFor(() => expect(requestedPaths()).toHaveLength(1))

      await vi.advanceTimersByTimeAsync(4 * 60_000)
      expect(requestedPaths()).toHaveLength(1)

      await vi.advanceTimersByTimeAsync(60_000)
      expect(requestedPaths()).toHaveLength(2)
      stream.send('ready', { cursor: 'c-0' })
      await vi.waitFor(() => expect(refreshAccount).toHaveBeenCalledOnce())
      expect(storedCursor()).toBe('c-0')
    } finally {
      vi.useRealTimers()
    }
  })

  it('announces live notifications in the notification center and records caught-up history silently', async () => {
    application.get('CacheService').setPersist('cherry_cloud.notification_cursors', { 'account-1': 'c-0' })
    reply('/api/v1/notifications', page([notification('n-1', 'c-1')], 'c-1'))
    const stream = eventStream()
    reply('/api/v1/notifications/stream', stream.response)
    const service = await start()

    await vi.waitFor(() => expect(createRecord).toHaveBeenCalledOnce())
    expect(createRecord.mock.calls[0][0]).toMatchObject({
      eventKey: 'cherry-cloud:n-1',
      target: { kind: 'settings', tab: 'profile' },
      readAt: expect.any(Number)
    })
    expect(publish).not.toHaveBeenCalled()
    expect(service.isActive()).toBe(false)

    stream.send('ready', { cursor: 'c-1' })
    await vi.waitFor(() => expect(service.isActive()).toBe(true))
    stream.send('notification', notification('n-2', 'c-2'))

    await vi.waitFor(() => expect(publish).toHaveBeenCalledOnce())
    expect(publish.mock.calls[0][0]).toMatchObject({ eventKey: 'cherry-cloud:n-2', category: 'usage' })
    expect(createRecord).toHaveBeenCalledOnce()
  })

  it('announces a live notification with the server copy and time, but not once past its presentation deadline', async () => {
    const stream = eventStream()
    reply('/api/v1/notifications/stream', stream.response)
    const service = await start()
    stream.send('ready', { cursor: 'c-0' })
    await vi.waitFor(() => expect(service.isActive()).toBe(true))

    const server = {
      title: '已关闭自动续费',
      body: '已关闭后续自动续费，已付周期内的权益仍可使用。',
      occurred_at: '2026-11-03T05:48:59Z'
    }
    stream.send('notification', { ...notification('n-1', 'c-1'), ...server, expires_at: '2999-01-01T00:00:00Z' })
    await vi.waitFor(() => expect(publish).toHaveBeenCalledOnce())
    expect(publish.mock.calls[0][0]).toMatchObject({
      title: server.title,
      message: server.body,
      createdAt: Date.parse(server.occurred_at)
    })

    stream.send('notification', { ...notification('n-2', 'c-2'), ...server, expires_at: '2000-01-01T00:00:00Z' })
    await vi.waitFor(() => expect(createRecord).toHaveBeenCalledOnce())
    expect(createRecord.mock.calls[0][0]).toMatchObject({ eventKey: 'cherry-cloud:n-2', readAt: expect.any(Number) })
    expect(publish).toHaveBeenCalledOnce()
  })

  it('announces an activation with the product copy that points to the CherryAI models', async () => {
    const stream = eventStream()
    reply('/api/v1/notifications/stream', stream.response)
    const service = await start()
    stream.send('ready', { cursor: 'c-0' })
    await vi.waitFor(() => expect(service.isActive()).toBe(true))

    stream.send('notification', {
      ...notification('n-1', 'c-1'),
      type: 'subscription.activated',
      title: '订阅已生效',
      body: '订阅权益已更新，请查看当前套餐。'
    })

    await vi.waitFor(() => expect(publish).toHaveBeenCalledOnce())
    expect(publish.mock.calls[0][0]).toMatchObject({
      title: '订阅已生效',
      message: t('notification.subscription.activated_message')
    })
    expect(t('notification.subscription.activated_message')).not.toBe('notification.subscription.activated_message')
  })

  it.each([
    [
      'subscription.renewal_reminder',
      '2026-12-03T12:00:00Z',
      () => t('notification.subscription.renewal_reminder_message', { date: '2026-12-03' })
    ],
    ['subscription.expired', '2999-01-01T00:00:00Z', () => t('notification.subscription.expired_message')],
    ['subscription.renewed', '2999-01-01T00:00:00Z', () => t('notification.subscription.renewed_message')],
    [
      'subscription.auto_renew_enabled',
      '2999-01-01T00:00:00Z',
      () => t('notification.subscription.auto_renew_enabled_message')
    ],
    [
      'subscription.entitlement_revoked',
      '2999-01-01T00:00:00Z',
      () => t('notification.subscription.entitlement_revoked_message')
    ],
    [
      'subscription.entitlement_restored',
      '2999-01-01T00:00:00Z',
      () => t('notification.subscription.entitlement_restored_message')
    ]
  ])('announces %s with product copy', async (type, expiresAt, expected) => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-30T00:00:00Z'))
    try {
      const stream = eventStream()
      reply('/api/v1/notifications/stream', stream.response)
      const service = await start()
      stream.send('ready', { cursor: 'c-0' })
      await vi.waitFor(() => expect(service.isActive()).toBe(true))

      stream.send('notification', { ...notification('n-1', 'c-1'), type, body: 'server text', expires_at: expiresAt })

      await vi.waitFor(() => expect(publish).toHaveBeenCalledOnce())
      expect(publish.mock.calls[0][0]).toMatchObject({ message: expected() })
      expect(expected()).not.toContain('notification.subscription')
    } finally {
      vi.useRealTimers()
    }
  })

  it('stays active across a transient disconnect so the catch-up is not announced by the client', async () => {
    vi.useFakeTimers()
    try {
      let close = () => {}
      const body = new ReadableStream<Uint8Array>({
        start: (controller) => {
          controller.enqueue(new TextEncoder().encode(`event: ready\ndata: ${JSON.stringify({ cursor: 'c-0' })}\n\n`))
          close = () => controller.close()
        }
      })
      reply('/api/v1/notifications/stream', new Response(body))
      const service = await start()
      await vi.waitFor(() => expect(service.isActive()).toBe(true))

      close()
      await vi.waitFor(() => expect(requestedPaths()).toContain('/api/v1/notifications/stream'))
      await vi.advanceTimersByTimeAsync(100)

      expect(service.isActive()).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('reports the stream inactive when the endpoints are not available', async () => {
    reply('/api/v1/notifications/stream', new Response(null, { status: 404 }))
    const service = await start()
    await vi.waitFor(() => expect(requestedPaths()).toHaveLength(1))

    expect(service.isActive()).toBe(false)
  })

  it('records one event once even when the server sends it under two ids', async () => {
    const stream = eventStream()
    reply('/api/v1/notifications/stream', stream.response)
    const service = await start()
    stream.send('ready', { cursor: 'c-0' })
    await vi.waitFor(() => expect(service.isActive()).toBe(true))

    const event = { type: 'subscription.activated', subscription_id: 'sub-1', occurred_at: '2026-11-09T11:24:22Z' }
    stream.send('notification', { ...notification('n-1', 'c-1'), ...event })
    stream.send('notification', { ...notification('n-2', 'c-2'), ...event })

    await vi.waitFor(() => expect(publish).toHaveBeenCalledTimes(2))
    const keys = publish.mock.calls.map(([record]) => (record as { eventKey: string }).eventKey)
    expect(keys[0]).toBe('cherry-cloud:subscription.activated:sub-1:2026-11-09T11:24:22Z')
    expect(keys[1]).toBe(keys[0])
  })

  it("never reuses another account's cursor", async () => {
    application.get('CacheService').setPersist('cherry_cloud.notification_cursors', { 'account-1': 'c-9' })
    status = signedIn('account-2')
    await start()

    await vi.waitFor(() => expect(requestedPaths()).toEqual(['/api/v1/notifications/stream']))
  })

  it("keeps each account's cursor, so switching back catches that account up", async () => {
    application
      .get('CacheService')
      .setPersist('cherry_cloud.notification_cursors', { 'account-1': 'a-9', 'account-2': 'b-3' })
    status = signedIn('account-2')
    await start()
    await vi.waitFor(() => expect(requestedPaths()).toEqual(['/api/v1/notifications?after=b-3&limit=50']))

    statusListener?.(signedOut)
    statusListener?.(signedIn('account-1'))

    await vi.waitFor(() => expect(requestedPaths()).toContain('/api/v1/notifications?after=a-9&limit=50'))
    expect(storedCursors()).toEqual({ 'account-1': 'a-9', 'account-2': 'b-3' })
  })

  it('opens a fresh baseline for the next account after a sign-in change', async () => {
    const first = eventStream()
    reply('/api/v1/notifications/stream', first.response)
    await start()
    await vi.waitFor(() => expect(requestedPaths()).toHaveLength(1))

    statusListener?.(signedOut)
    statusListener?.(signedIn('account-2'))

    await vi.waitFor(() =>
      expect(requestedPaths()).toEqual(['/api/v1/notifications/stream', '/api/v1/notifications/stream'])
    )
  })

  it('retries a notification whose refresh failed when it is caught up again', async () => {
    vi.useFakeTimers()
    try {
      const stream = eventStream()
      reply('/api/v1/notifications/stream', stream.response)
      await start()
      stream.send('ready', { cursor: 'c-0' })
      await vi.waitFor(() => expect(refreshAccount).toHaveBeenCalledOnce())

      refreshAccount.mockRejectedValueOnce(new Error('offline'))
      reply('/api/v1/notifications', page([notification('n-1', 'c-1')], 'c-1'))
      stream.send('notification', notification('n-1', 'c-1'))
      await vi.waitFor(() => expect(refreshAccount).toHaveBeenCalledTimes(2))
      expect(storedCursor()).toBe('c-0')

      await vi.advanceTimersByTimeAsync(2_000)

      await vi.waitFor(() => expect(refreshAccount).toHaveBeenCalledTimes(3))
      expect(requestedPaths()).toContain('/api/v1/notifications?after=c-0&limit=50')
      await vi.waitFor(() => expect(storedCursor()).toBe('c-1'))
    } finally {
      vi.useRealTimers()
    }
  })
  it('does not acknowledge a ready refresh after the connection is cancelled', async () => {
    const stream = eventStream()
    let complete!: (result: { outcome: string }) => void
    refreshAccount.mockReturnValueOnce(
      new Promise((resolve) => {
        complete = resolve
      })
    )
    reply('/api/v1/notifications/stream', stream.response)
    await start()
    stream.send('ready', { cursor: 'late' })
    await vi.waitFor(() => expect(refreshAccount).toHaveBeenCalledOnce())
    statusListener?.(signedOut)
    complete({ outcome: 'refreshed' })
    await Promise.resolve()
    expect(storedCursor()).toBeNull()
  })

  it('does not commit ready before the required refresh succeeds', async () => {
    const stream = eventStream()
    refreshAccount.mockResolvedValueOnce({ outcome: 'failed' })
    reply('/api/v1/notifications/stream', stream.response)
    await start()
    stream.send('ready', { cursor: 'unprocessed' })
    await vi.waitFor(() => expect(refreshAccount).toHaveBeenCalledOnce())
    expect(storedCursor()).toBeNull()
  })

  it('increases reconnect delays across failed ready refreshes and resets after a successful ready', async () => {
    vi.useFakeTimers()
    const jitter = vi.spyOn(Math, 'random').mockReturnValue(0.5)
    try {
      const streams = [eventStream(), eventStream(), eventStream(), eventStream()]
      const attempts: number[] = []
      reply(
        '/api/v1/notifications/stream',
        ...streams.map((stream) => () => {
          attempts.push(Date.now())
          return stream.response
        })
      )
      refreshAccount
        .mockResolvedValueOnce({ outcome: 'failed' })
        .mockResolvedValueOnce({ outcome: 'failed' })
        .mockResolvedValueOnce({ outcome: 'refreshed' })
      await start()
      const firstFailureAt = Date.now()
      streams[0].send('ready', { cursor: 'failed-first' })
      await vi.waitFor(() => expect(refreshesAnnounced()).toBe(1))
      await vi.advanceTimersByTimeAsync(0)
      expect(storedCursor()).toBeNull()

      await vi.advanceTimersToNextTimerAsync()
      expect(attempts).toHaveLength(2)
      const firstDelay = attempts[1] - firstFailureAt
      const secondFailureAt = Date.now()
      streams[1].send('ready', { cursor: 'failed-second' })
      await vi.waitFor(() => expect(refreshesAnnounced()).toBe(2))
      await vi.advanceTimersByTimeAsync(0)
      expect(storedCursor()).toBeNull()

      await vi.advanceTimersToNextTimerAsync()
      expect(attempts).toHaveLength(3)
      const secondDelay = attempts[2] - secondFailureAt
      expect(firstDelay).toBeGreaterThan(0)
      expect(secondDelay).toBeGreaterThan(firstDelay)
      streams[2].send('ready', { cursor: 'processed' })
      await vi.waitFor(() => expect(storedCursor()).toBe('processed'))
      reply('/api/v1/notifications', page([], 'processed'))
      const afterSuccessFailureAt = Date.now()
      streams[2].send('error', { code: 'SERVICE_UNAVAILABLE' })
      await vi.advanceTimersByTimeAsync(0)

      await vi.advanceTimersToNextTimerAsync()
      expect(attempts).toHaveLength(4)
      const resetDelay = attempts[3] - afterSuccessFailureAt
      expect(resetDelay).toBeGreaterThan(0)
      expect(resetDelay).toBeLessThanOrEqual(firstDelay)
      expect(resetDelay).toBeLessThan(secondDelay)
      expect(storedCursor()).toBe('processed')
    } finally {
      statusListener?.(signedOut)
      jitter.mockRestore()
      vi.useRealTimers()
    }
  })
})
