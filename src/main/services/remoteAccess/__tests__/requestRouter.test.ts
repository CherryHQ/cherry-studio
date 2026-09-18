import { beforeEach, describe, expect, it, vi } from 'vitest'

import { RemoteRequestError } from '../protocol'

const access = vi.hoisted(() => ({
  authorize: vi.fn(),
  listAgents: vi.fn(),
  sessionSnapshot: vi.fn(() => ({ status: 'idle' })),
  observeSession: vi.fn(() => ({ dispose: vi.fn() })),
  translateAgentError: vi.fn(() => undefined)
}))

const commands = vi.hoisted(() => ({ cancelTurn: vi.fn() }))

vi.mock('../agentAccess', () => access)
vi.mock('../agentCommands', () => commands)

const { RequestRouter } = await import('../requestRouter')

const SESSION = 'session'
const COMMAND = '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d000'

function createRouter() {
  const sent: any[] = []
  const close = vi.fn()
  const router = new RequestRouter({ deviceId: 'phone' }, 'desktop', (value) => sent.push(value), close)
  const request = (requestId: string, method: string, params: unknown = {}) =>
    router.receive({ type: 'request', requestId, method, params })
  return { router, sent, close, request }
}

describe('remote request routing limits', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    access.authorize.mockImplementation(() => {})
    access.listAgents.mockResolvedValue({ items: [], nextCursor: null })
  })

  it('answers each request under its own ID and reports protocol mistakes without leaking internals', async () => {
    const { router, sent, request } = createRouter()
    access.listAgents.mockRejectedValueOnce(new Error('SELECT * FROM agent failed at /Users/me/db.sqlite'))

    request('ok', 'system.info')
    request('unknown', 'agents.delete')
    request('invalid', 'agents.list', { limit: 500 })
    request('crash', 'agents.list')
    await router.drain()

    expect(sent.find((item) => item.requestId === 'ok').result).toMatchObject({ protocolVersion: 1 })
    expect(sent.filter((item) => item.error)).toEqual([
      { type: 'response', requestId: 'unknown', error: { code: 'METHOD_NOT_FOUND', retryable: false } },
      { type: 'response', requestId: 'invalid', error: { code: 'INVALID_REQUEST', retryable: false } },
      { type: 'response', requestId: 'crash', error: { code: 'INTERNAL_ERROR', retryable: false } }
    ])
  })

  it('closes the connection on a malformed envelope or a reused request ID', () => {
    const malformed = createRouter()
    malformed.router.receive({ type: 'request', requestId: 'r1', method: 'system.info', extra: true })
    expect(malformed.close).toHaveBeenCalledTimes(1)

    const reused = createRouter()
    reused.request('r1', 'system.info')
    reused.request('r1', 'system.info')
    expect(reused.close).toHaveBeenCalledTimes(1)
  })

  it('withholds a result from a device revoked while its request was running', async () => {
    const { router, sent, request } = createRouter()
    let finish!: (value: unknown) => void
    access.listAgents.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)))

    request('r1', 'agents.list')
    await Promise.resolve()
    access.authorize.mockImplementation(() => {
      throw new RemoteRequestError('FORBIDDEN')
    })
    finish({ items: [{ id: 'secret-agent' }], nextCursor: null })
    await router.drain()

    expect(sent).toEqual([{ type: 'response', requestId: 'r1', error: { code: 'FORBIDDEN', retryable: false } }])
  })

  it('sheds ordinary requests beyond eight in flight while still admitting cancel and approval', async () => {
    const { router, sent, request } = createRouter()
    const pending = new Promise(() => {})
    access.listAgents.mockReturnValue(pending)
    commands.cancelTurn.mockReturnValue(pending)
    const cancel = { sessionId: SESSION, commandId: COMMAND, expectedExecutionId: 'execution' }

    for (let index = 0; index < 9; index++) request(`regular-${index}`, 'agents.list')
    for (let index = 0; index < 3; index++) request(`control-${index}`, 'turns.cancel', cancel)
    await Promise.resolve()

    expect(sent).toEqual([
      { type: 'response', requestId: 'regular-8', error: { code: 'RATE_LIMITED', retryable: true } },
      { type: 'response', requestId: 'control-2', error: { code: 'RATE_LIMITED', retryable: true } }
    ])
    expect(commands.cancelTurn).toHaveBeenCalledTimes(2)
    router.dispose()
  })

  it('reuses a subscription for the same session, caps them at four, and releases them on disconnect', async () => {
    const { router, sent, request } = createRouter()
    const observers = Array.from({ length: 4 }, () => ({ dispose: vi.fn() }))
    for (const observer of observers) access.observeSession.mockReturnValueOnce(observer)

    for (const session of ['a', 'a', 'b', 'c', 'd', 'e']) {
      request(`subscribe-${sent.length}`, 'session.subscribe', { sessionId: session })
      await router.drain()
    }

    const [first, again, , , , fifth] = sent
    expect(again.result.subscriptionId).toBe(first.result.subscriptionId)
    expect(fifth.error).toEqual({ code: 'SUBSCRIPTION_LIMIT', retryable: false })

    router.dispose()
    for (const observer of observers) expect(observer.dispose).toHaveBeenCalledTimes(1)
  })

  it('stays silent after the connection is gone', async () => {
    const { router, sent, request } = createRouter()
    let finish!: (value: unknown) => void
    access.listAgents.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)))

    request('r1', 'agents.list')
    await Promise.resolve()
    router.dispose()
    finish({ items: [], nextCursor: null })
    await router.drain()
    request('r2', 'system.info')

    expect(sent).toEqual([])
  })
})
