import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  CHILD_EXIT_CODES,
  CHILD_SELF_EXIT_DELAY_MS,
  PROTOCOL,
  PROTOCOL_VERSION,
  REQUEST_CANCELLED_CODE,
  SHUTDOWN_CODE
} from '../protocol/constants'
import type { ChildFrame, ConnectFrame, FrameIdentity, MainFrame, Unstamped } from '../protocol/frames'
import type { ServeUtilityProcessOptions, UtilityProcessHandlerContext } from '../runtime/utilityProcessServer'
import type { UtilityProcessMethod } from '../types'
import { createMemoryProcessAdapter, flushMicrotasks, type MemoryChild, waitUntil } from './memoryProcessAdapter'

type TestContract = {
  methods: {
    echo: UtilityProcessMethod<unknown, unknown, unknown>
    wait: UtilityProcessMethod<void, string, unknown>
    fail: UtilityProcessMethod<{ sync: boolean }, never>
  }
}

const ID = 'test.child'
const identity: FrameIdentity = { protocol: PROTOCOL, version: PROTOCOL_VERSION, processId: ID, generation: 3 }

/** Drives the real child runtime from a fake main. */
function setup(overrides: Partial<ServeUtilityProcessOptions<TestContract, unknown>> = {}) {
  const frames: ChildFrame[] = []
  const contexts: UtilityProcessHandlerContext<unknown>[] = []
  let child!: MemoryChild
  const options: ServeUtilityProcessOptions<TestContract, unknown> = {
    id: ID,
    handlers: {
      echo: (input, context) => {
        contexts.push(context)
        return input
      },
      wait: (_input, context) =>
        new Promise<string>((_resolve, reject) => {
          contexts.push(context)
          context.signal.addEventListener('abort', () => reject(context.signal.reason), { once: true })
        }),
      fail: ({ sync }) => {
        const error = Object.assign(new RangeError('boom'), { code: 'E_BOOM' })
        if (sync) throw error
        return Promise.reject(error)
      }
    },
    ...overrides
  }
  const adapter = createMemoryProcessAdapter((spawned) => {
    child = spawned
    child.serve(options)
  })
  const handle = adapter.spawn({ entryPath: '/entry.js', env: {}, serviceName: 'test' })
  handle.onMessage((data) => frames.push(data as ChildFrame))
  const connect = (frame: Partial<ConnectFrame> = {}) =>
    handle.connect({ ...identity, kind: 'connect', initData: undefined, ...frame })
  const send = (frame: Unstamped<MainFrame>) => handle.send({ ...identity, ...frame } as MainFrame)
  const kinds = () => frames.map((frame) => frame.kind)
  const ready = async () => {
    connect()
    await waitUntil(() => kinds().includes('ready'), 'ready frame')
  }
  return { child: () => child, handle, frames, kinds, contexts, connect, send, ready }
}

describe('serveUtilityProcess runtime', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('sends ready only after initialize resolves and passes it the init data', async () => {
    let release!: () => void
    const seen: unknown[] = []
    const t = setup({
      initialize: (initData) => {
        seen.push(initData)
        return new Promise<void>((resolve) => {
          release = resolve
        })
      }
    })
    t.connect({ initData: { model: 'x' } })
    await flushMicrotasks()
    expect(t.kinds()).not.toContain('ready')
    expect(seen).toEqual([{ model: 'x' }])

    release()
    await waitUntil(() => t.kinds().includes('ready'), 'ready')
  })

  it('reports an initialize failure as startup-error, never ready, and exits 71 on its own', async () => {
    const t = setup({
      initialize: () => {
        throw new TypeError('missing binding')
      }
    })
    t.connect()
    await waitUntil(() => t.kinds().includes('startup-error'), 'startup-error')
    expect(t.frames.find((f) => f.kind === 'startup-error')).toMatchObject({
      error: { name: 'TypeError', message: 'missing binding' }
    })
    expect(t.kinds()).not.toContain('ready')

    await vi.advanceTimersByTimeAsync(CHILD_SELF_EXIT_DELAY_MS)
    expect(t.child().exitCode).toBe(CHILD_EXIT_CODES.startupFailed)
  })

  it('exits 70 when the connect frame targets another process id', async () => {
    const t = setup()
    t.connect({ processId: 'test.other' })
    await flushMicrotasks()
    expect(t.child().exitCode).toBe(CHILD_EXIT_CODES.badConnect)
  })

  it('returns a result terminal carrying structured-clone payloads', async () => {
    const t = setup()
    await t.ready()
    const bytes = new Uint8Array([1, 2, 3])
    t.send({ kind: 'request', requestId: 1, method: 'echo', input: { bytes } })
    await waitUntil(() => t.kinds().includes('result'), 'result')
    const result = t.frames.find((f) => f.kind === 'result')
    expect(result).toMatchObject({ requestId: 1, generation: 3, processId: ID })
    expect((result as { output: { bytes: Uint8Array } }).output.bytes).toEqual(bytes)
  })

  it.each([true, false])(
    'turns a handler throw (sync=%s) into an error terminal with name, message, and code',
    async (sync) => {
      const t = setup()
      await t.ready()
      t.send({ kind: 'request', requestId: 1, method: 'fail', input: { sync } })
      await waitUntil(() => t.kinds().includes('error'), 'error')
      expect(t.frames.find((f) => f.kind === 'error')).toMatchObject({
        requestId: 1,
        error: { name: 'RangeError', message: 'boom', code: 'E_BOOM' }
      })
      expect(t.child().exited).toBe(false)
    }
  )

  it('treats an unknown method as a fatal violation and self-exits 72 after the grace delay', async () => {
    const t = setup()
    await t.ready()
    t.send({ kind: 'request', requestId: 1, method: 'nope', input: undefined })
    await waitUntil(() => t.kinds().includes('protocol-error'), 'protocol-error')
    expect(t.frames.find((f) => f.kind === 'protocol-error')).toMatchObject({ requestId: 1 })
    expect(t.child().exited).toBe(false)
    await vi.advanceTimersByTimeAsync(CHILD_SELF_EXIT_DELAY_MS)
    expect(t.child().exitCode).toBe(CHILD_EXIT_CODES.protocolViolation)
  })

  it('treats a repeated or reordered requestId as a fatal violation', async () => {
    const t = setup()
    await t.ready()
    t.send({ kind: 'request', requestId: 2, method: 'echo', input: 'a' })
    t.send({ kind: 'request', requestId: 1, method: 'echo', input: 'b' })
    await waitUntil(() => t.kinds().includes('protocol-error'), 'protocol-error')
    expect(t.frames.find((f) => f.kind === 'protocol-error')).toMatchObject({ requestId: 1 })
  })

  it('rejects frames stamped with another generation', async () => {
    const t = setup()
    await t.ready()
    t.handle.send({ ...identity, generation: 4, kind: 'request', requestId: 1, method: 'echo', input: 'x' })
    await waitUntil(() => t.kinds().includes('protocol-error'), 'protocol-error')
  })

  it('aborts the handler signal on cancel with the fixed cancellation code, and still sends the terminal', async () => {
    const t = setup()
    await t.ready()
    t.send({ kind: 'request', requestId: 1, method: 'wait', input: undefined })
    await waitUntil(() => t.contexts.length === 1, 'handler started')
    t.send({ kind: 'cancel', requestId: 1 })
    await waitUntil(() => t.contexts[0].signal.aborted, 'signal aborted')
    expect((t.contexts[0].signal.reason as { code: string }).code).toBe(REQUEST_CANCELLED_CODE)
    await waitUntil(() => t.kinds().includes('error'), 'terminal after cancel')
    expect(t.frames.find((f) => f.kind === 'error')).toMatchObject({ requestId: 1, error: { name: 'AbortError' } })
  })

  it('ignores cancel for unknown or finished requests and keeps serving', async () => {
    const t = setup()
    await t.ready()
    t.send({ kind: 'cancel', requestId: 9 })
    t.send({ kind: 'request', requestId: 1, method: 'echo', input: 'ok' })
    await waitUntil(() => t.kinds().includes('result'), 'result')
    expect(t.kinds()).not.toContain('protocol-error')
  })

  it('drops events emitted after the terminal', async () => {
    let leakedEmit!: (event: unknown) => void
    const t = setup({
      handlers: {
        echo: (input, context) => {
          leakedEmit = context.emit
          context.emit('before')
          return input
        },
        wait: async () => 'unused',
        fail: () => Promise.reject(new Error('unused'))
      }
    })
    await t.ready()
    t.send({ kind: 'request', requestId: 1, method: 'echo', input: 'x' })
    await waitUntil(() => t.kinds().includes('result'), 'result')
    leakedEmit('after')
    await flushMicrotasks()
    expect(t.frames.filter((f) => f.kind === 'event')).toHaveLength(1)
  })

  it('converts an unclonable result into a serialization error terminal and stays alive', async () => {
    const t = setup()
    await t.ready()
    t.send({ kind: 'request', requestId: 1, method: 'echo', input: undefined })
    // The input is cloneable; make the handler's output unclonable by echoing a function through a wrapper.
    t.frames.length = 0
    const adapterWithFn = setup({ handlers: { ...t.contexts, echo: () => () => 1 } as never })
    await adapterWithFn.ready()
    adapterWithFn.send({ kind: 'request', requestId: 1, method: 'echo', input: undefined })
    await waitUntil(() => adapterWithFn.kinds().includes('error'), 'error')
    expect(adapterWithFn.frames.find((f) => f.kind === 'error')).toMatchObject({
      requestId: 1,
      error: { name: 'DataCloneError', code: 'PROCESS_SERIALIZATION_FAILED' }
    })
    adapterWithFn.send({ kind: 'request', requestId: 2, method: 'echo', input: undefined })
    await waitUntil(() => adapterWithFn.frames.some((f) => f.kind === 'error' && f.requestId === 2), 'alive')
    expect(adapterWithFn.child().exited).toBe(false)
  })

  it('converts an unclonable event into a serialization error terminal and aborts the handler', async () => {
    let signal!: AbortSignal
    const t = setup({
      handlers: {
        echo: (_input, context) => {
          signal = context.signal
          context.emit(() => 1)
          return new Promise(() => {})
        },
        wait: async () => 'unused',
        fail: () => Promise.reject(new Error('unused'))
      }
    })
    await t.ready()
    t.send({ kind: 'request', requestId: 1, method: 'echo', input: undefined })
    await waitUntil(() => t.kinds().includes('error'), 'error')
    expect(t.frames.find((f) => f.kind === 'error')).toMatchObject({
      error: { code: 'PROCESS_SERIALIZATION_FAILED' }
    })
    expect(signal.aborted).toBe(true)
  })

  it('shuts down in order: abort handlers, wait for them, dispose, close port, exit 0', async () => {
    const order: string[] = []
    const t = setup({
      handlers: {
        echo: (input) => input,
        wait: (_input, context) =>
          new Promise<string>((_resolve, reject) => {
            context.signal.addEventListener(
              'abort',
              () => {
                order.push(`abort:${(context.signal.reason as { code: string }).code}`)
                // Handler takes a tick to settle after abort; dispose must still wait for it.
                queueMicrotask(() => {
                  order.push('handler-settled')
                  reject(context.signal.reason)
                })
              },
              { once: true }
            )
          }),
        fail: () => Promise.reject(new Error('unused'))
      },
      dispose: () => {
        order.push('dispose')
      }
    })
    await t.ready()
    t.send({ kind: 'request', requestId: 1, method: 'wait', input: undefined })
    await flushMicrotasks()
    t.send({ kind: 'shutdown' })
    await waitUntil(() => t.child().exited, 'exit')
    expect(order).toEqual([`abort:${SHUTDOWN_CODE}`, 'handler-settled', 'dispose'])
    expect(t.child().exitCode).toBe(0)
    expect(t.child().childPort.closed).toBe(true)
  })

  it('stamps request-scoped log frames with the requestId and initialize logs without one', async () => {
    const t = setup({
      initialize: (_initData, { logger }) => logger.info('booting'),
      handlers: {
        echo: (input, { logger }) => {
          logger.warn('working', { step: 1 })
          return input
        },
        wait: async () => 'unused',
        fail: () => Promise.reject(new Error('unused'))
      }
    })
    await t.ready()
    t.send({ kind: 'request', requestId: 7, method: 'echo', input: 1 })
    await waitUntil(() => t.kinds().includes('result'), 'result')
    const logs = t.frames.filter((f) => f.kind === 'log')
    expect(logs).toEqual([
      expect.objectContaining({ level: 'info', message: 'booting' }),
      expect.objectContaining({ level: 'warn', message: 'working', fields: { step: 1 }, requestId: 7 })
    ])
    expect('requestId' in logs[0]).toBe(false)
  })

  it('exits 73 on an uncaught error after aborting active handlers, without reporting them as terminals', async () => {
    const t = setup()
    await t.ready()
    t.send({ kind: 'request', requestId: 1, method: 'wait', input: undefined })
    await waitUntil(() => t.contexts.length === 1, 'handler started')
    t.child().triggerFatal(new Error('native crash'))
    await vi.advanceTimersByTimeAsync(0)
    expect(t.contexts[0].signal.aborted).toBe(true)
    expect(t.child().exitCode).toBe(CHILD_EXIT_CODES.uncaught)
    expect(t.frames.find((f) => f.kind === 'log')).toMatchObject({ level: 'error' })
    // The unwinding `wait` handler rejected; main must learn of the crash from the exit alone.
    expect(t.kinds()).not.toContain('error')
    expect(t.kinds()).not.toContain('result')
  })

  it('shutdown waits for a handler that ignores its abort after an unclonable event before running dispose', async () => {
    const order: string[] = []
    let release!: () => void
    const t = setup({
      handlers: {
        echo: (_input, context) => {
          context.emit(() => 1)
          return new Promise((resolve) => {
            release = () => {
              order.push('handler-settled')
              resolve('late')
            }
          })
        },
        wait: async () => 'unused',
        fail: () => Promise.reject(new Error('unused'))
      },
      dispose: () => {
        order.push('dispose')
      }
    })
    await t.ready()
    t.send({ kind: 'request', requestId: 1, method: 'echo', input: undefined })
    await waitUntil(() => t.kinds().includes('error'), 'serialization terminal')

    t.send({ kind: 'shutdown' })
    await flushMicrotasks()
    expect(order).toEqual([])
    expect(t.child().exited).toBe(false)

    release()
    await waitUntil(() => t.child().exited, 'exit')
    expect(order).toEqual(['handler-settled', 'dispose'])
    expect(t.child().exitCode).toBe(0)
  })
})
