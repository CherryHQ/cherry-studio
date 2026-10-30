import { MockApplicationUtils } from '@test-mocks/main/application'
import { MockMainCacheServiceUtils } from '@test-mocks/main/CacheService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import type * as LifecycleModule from '@main/core/lifecycle'
import { getConditions } from '@main/core/lifecycle/decorators'
import type { ConditionContext } from '@main/core/lifecycle/types'
import type { CherryCloudStatus } from '@shared/ipc/schemas/cherryCloud'

const edition = vi.hoisted(() => ({ current: 'cn' as 'cn' | 'global' }))
vi.mock('@main/utils/appEdition', () => ({ getAppEdition: () => edition.current }))

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

const signedIn = (accountId: string): CherryCloudStatus => ({ phase: 'signed-in', accountId, displayName: null })
const signedOut: CherryCloudStatus = { phase: 'signed-out', accountId: null, displayName: null }

/** An open SSE response whose events the test pushes; it never ends on its own. */
function eventStream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const body = new ReadableStream<Uint8Array>({ start: (c) => void (controller = c) })
  return {
    response: new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }),
    send(event: string, data: unknown) {
      controller.enqueue(new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
    }
  }
}

const jsonError = (status: number, code: string) =>
  new Response(JSON.stringify({ type: 'error', error: { code } }), { status })
const page = (notifications: unknown[], nextCursor: string | null = null) =>
  new Response(JSON.stringify({ notifications, next_cursor: nextCursor }))
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
const refreshEntitledModels = vi.fn(async () => undefined)

const requestedPaths = () => authenticatedFetch.mock.calls.map(([path]) => path)
const broadcast = () => vi.mocked(application.get('IpcApiService').broadcast)
const refreshesAnnounced = () =>
  broadcast().mock.calls.filter(([event]) => event === 'cherry_cloud.account_refreshed').length
const storedCursor = () => application.get('CacheService').getPersist('cherry_cloud.notification_cursor')

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
    refreshEntitledModels
  })
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
    expect(refreshEntitledModels).toHaveBeenCalledOnce()
    expect(storedCursor()).toEqual({ accountId: 'account-1', cursor: 'c-0' })
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

    await vi.waitFor(() => expect(storedCursor()).toEqual({ accountId: 'account-1', cursor: 'c-3' }))
    expect(refreshEntitledModels).toHaveBeenCalledTimes(2)
    expect(refreshesAnnounced()).toBe(2)
  })

  it('catches up from the stored cursor before reconnecting to the stream', async () => {
    application
      .get('CacheService')
      .setPersist('cherry_cloud.notification_cursor', { accountId: 'account-1', cursor: 'c-5' })
    reply(
      '/api/v1/notifications',
      page([notification('n-6', 'c-6'), notification('n-7', 'c-7')], 'c-7'),
      page([notification('n-8', 'c-8', [])])
    )
    await start()

    await vi.waitFor(() =>
      expect(requestedPaths()).toEqual([
        '/api/v1/notifications?after=c-5&limit=50',
        '/api/v1/notifications?after=c-7&limit=50',
        '/api/v1/notifications/stream?after=c-8'
      ])
    )
    expect(refreshEntitledModels).toHaveBeenCalledOnce()
    expect(storedCursor()).toEqual({ accountId: 'account-1', cursor: 'c-8' })
  })

  it.each([
    [400, 'INVALID_CURSOR'],
    [410, 'RESYNC_REQUIRED']
  ])('rebuilds the baseline when the cursor is rejected with %i %s', async (code, errorCode) => {
    application
      .get('CacheService')
      .setPersist('cherry_cloud.notification_cursor', { accountId: 'account-1', cursor: 'stale' })
    reply('/api/v1/notifications', jsonError(code, errorCode))
    await start()

    await vi.waitFor(() =>
      expect(requestedPaths()).toEqual(['/api/v1/notifications?after=stale&limit=50', '/api/v1/notifications/stream'])
    )
    expect(storedCursor()).toBeNull()
  })

  it('stops without retrying when the notification endpoints are not available', async () => {
    vi.useFakeTimers()
    try {
      reply('/api/v1/notifications/stream', new Response(null, { status: 404 }))
      await start()
      await vi.waitFor(() => expect(requestedPaths()).toHaveLength(1))

      await vi.advanceTimersByTimeAsync(120_000)

      expect(requestedPaths()).toHaveLength(1)
      expect(refreshEntitledModels).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it("never reuses another account's cursor", async () => {
    application
      .get('CacheService')
      .setPersist('cherry_cloud.notification_cursor', { accountId: 'account-1', cursor: 'c-9' })
    status = signedIn('account-2')
    await start()

    await vi.waitFor(() => expect(requestedPaths()).toEqual(['/api/v1/notifications/stream']))
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
      await vi.waitFor(() => expect(refreshEntitledModels).toHaveBeenCalledOnce())

      refreshEntitledModels.mockRejectedValueOnce(new Error('offline'))
      reply('/api/v1/notifications', page([notification('n-1', 'c-1')]))
      stream.send('notification', notification('n-1', 'c-1'))
      await vi.waitFor(() => expect(refreshEntitledModels).toHaveBeenCalledTimes(2))
      expect(storedCursor()).toEqual({ accountId: 'account-1', cursor: 'c-0' })

      await vi.advanceTimersByTimeAsync(2_000)

      await vi.waitFor(() => expect(refreshEntitledModels).toHaveBeenCalledTimes(3))
      expect(requestedPaths()).toContain('/api/v1/notifications?after=c-0&limit=50')
      await vi.waitFor(() => expect(storedCursor()).toEqual({ accountId: 'account-1', cursor: 'c-1' }))
    } finally {
      vi.useRealTimers()
    }
  })
})
