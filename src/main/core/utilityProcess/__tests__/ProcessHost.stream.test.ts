import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest'

import { defineUtilityProcess } from '../defineUtilityProcess'
import { ProcessHost } from '../host/ProcessHost'
import type { UtilityProcessStreamHandlers } from '../runtime/utilityProcessServer'
import type {
  UtilityProcessClient,
  UtilityProcessMethod,
  UtilityProcessStreamFrame,
  UtilityProcessStreamMethod
} from '../types'
import { createRecordingLogger } from './hostTestUtils'
import { createMemoryProcessAdapter, flushMicrotasks, waitUntil } from './memoryProcessAdapter'

type Contract = {
  methods: { ping: UtilityProcessMethod<void, string>; events: UtilityProcessMethod<void, number, number> }
  streams: {
    duplex: UtilityProcessStreamMethod<void, UtilityProcessStreamFrame, UtilityProcessStreamFrame, number>
    produce: UtilityProcessStreamMethod<number, never, UtilityProcessStreamFrame, number>
  }
}
const limits = { maxFrameBytes: 32, maxBufferedBytes: 32, maxBufferedFrames: 2, maxPendingWrites: 2 }
const options = { input: limits, output: limits }
const frame = (n: number): UtilityProcessStreamFrame => ({ metadata: { n }, payload: new Uint8Array(8).fill(n) })
const hosts: ProcessHost<Contract, void>[] = []

function setup(
  overrides: Partial<UtilityProcessStreamHandlers<Contract>> = {},
  cancellation: 'cooperative' | 'terminate' = 'cooperative'
) {
  const definition = defineUtilityProcess<Contract>({
    id: 'test.stream',
    entry: 'test-stream',
    cancellation,
    idleTimeoutMs: 100
  })
  const adapter = createMemoryProcessAdapter((child) => {
    child.serve<Contract>({
      id: definition.id,
      handlers: {
        ping: () => 'pong',
        events: (_, { emit }) => {
          emit(1)
          emit(2)
          return 3
        }
      },
      streams: {
        duplex: async (_, { input, write }) => {
          let count = 0
          for await (const item of input) {
            await write(item)
            count++
          }
          return count
        },
        produce: async (count, { write }) => {
          for (let n = 0; n < count; n++) await write(frame(n))
          return count
        },
        ...overrides
      }
    })
  })
  const host = new ProcessHost(definition, {
    adapter,
    logger: createRecordingLogger(),
    resolveEntry: () => '/out/test.js',
    getTempDir: () => '/tmp/test-stream'
  })
  hosts.push(host)
  return { host, adapter }
}

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(hosts.splice(0).map((host) => host.dispose()))
})

describe('ProcessHost bounded streams', () => {
  it('rejects invalid capacity before spawning', async () => {
    const { host, adapter } = setup()
    await expect(
      host.openStream('produce', 1, { ...options, input: { ...limits, maxPendingWrites: 0 } })
    ).rejects.toThrow('limits')
    expect(adapter.spawns).toHaveLength(0)
  })

  it('rejects unsubmitted input when a handler completes without reading it', async () => {
    const gate = Promise.withResolvers<number>()
    const { host } = setup({ duplex: () => gate.promise })
    const stream = await host.openStream('duplex', undefined, options)
    await stream.write(frame(1))
    await stream.write(frame(2))
    const waiting = stream.write(frame(3))
    const eof = stream.finishInput()
    gate.resolve(0)
    await expect(waiting).rejects.toThrow('closed')
    await expect(eof).rejects.toThrow('closed')
    await expect(stream.completed).resolves.toBe(0)
    await stream.closed
  })

  it('preserves stream method, frame, and result types, including output-only input', async () => {
    const { host } = setup()
    expectTypeOf(host.openStream).parameter(0).toEqualTypeOf<'duplex' | 'produce'>()
    expectTypeOf<UtilityProcessClient<{ methods: Contract['methods'] }>['openStream']>()
      .parameter(0)
      .toEqualTypeOf<never>()
    const stream = await host.openStream('produce', 0, options)
    expectTypeOf(stream.write).parameter(0).toEqualTypeOf<never>()
    expectTypeOf(stream.completed).toEqualTypeOf<Promise<number>>()
    await expect(stream.completed).resolves.toBe(0)
    await stream.closed
  })

  it('wakes a child input reader and host output reader when a signal aborts', async () => {
    const { host } = setup()
    const controller = new AbortController()
    const stream = await host.openStream('duplex', undefined, { ...options, signal: controller.signal })
    const pending = stream.output[Symbol.asyncIterator]().next()
    const error = new Error('dictation ended')
    controller.abort(error)
    await expect(pending).rejects.toBe(error)
    await expect(stream.completed).rejects.toBe(error)
    await stream.closed
    await expect(host.request('ping', undefined)).resolves.toBe('pong')
  })

  it('keeps closed pending when a failed stop cannot prove process exit', async () => {
    vi.useFakeTimers()
    const { host, adapter } = setup({ produce: async () => new Promise<number>(() => {}) })
    const stream = await host.openStream('produce', 1, options)
    adapter.spawns[0].child.onKill(() => {})
    let closed = false
    void stream.closed.then(() => {
      closed = true
    })
    const stopped = host.stop().catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(4000)
    expect(await stopped).toMatchObject({ code: 'PROCESS_STOP_FAILED' })
    expect(closed).toBe(false)
    adapter.spawns[0].child.exit(143)
    await stream.closed
    expect(closed).toBe(true)
  })

  it('rejects a result before EOF and a duplicate terminal as protocol failures', async () => {
    const { host, adapter } = setup({ produce: async () => new Promise<number>(() => {}) })
    const stream = await host.openStream('produce', 1, options)
    adapter.spawns[0].child.reply({ kind: 'result', requestId: 1, output: 1 })
    await expect(stream.completed).rejects.toMatchObject({ code: 'PROCESS_PROTOCOL_ERROR' })
    await stream.closed
    const next = await host.openStream('produce', 1, options)
    const child = adapter.spawns[1].child
    child.reply({ kind: 'error', requestId: 1, error: { name: 'Error', message: 'failed' } })
    child.reply({ kind: 'error', requestId: 1, error: { name: 'Error', message: 'duplicate' } })
    await expect(next.completed).rejects.toMatchObject({ code: 'PROCESS_REMOTE_ERROR' })
    await next.closed
    expect(child.exited).toBe(true)
  })

  it('streams both directions in order through EOF while ordinary events retain their behavior', async () => {
    const { host } = setup()
    const stream = await host.openStream('duplex', undefined, options)
    const collected: number[] = []
    const reading = (async () => {
      for await (const item of stream.output) collected.push(item.metadata.n as number)
    })()
    for (let i = 0; i < 20; i++) await stream.write(frame(i))
    await stream.finishInput()
    await reading
    await expect(stream.completed).resolves.toBe(20)
    await stream.closed
    expect(collected).toEqual(Array.from({ length: 20 }, (_, n) => n))
    const events: number[] = []
    await expect(host.request('events', undefined, { onEvent: (n) => events.push(n) })).resolves.toBe(3)
    expect(events).toEqual([1, 2])
  })

  it('keeps cancelled resources active until handler cleanup acknowledges, including before output iteration', async () => {
    vi.useFakeTimers()
    const gate = Promise.withResolvers<void>()
    const { host, adapter } = setup({
      produce: async (_, { write }) => {
        try {
          for (;;) await write(frame(1))
        } finally {
          await gate.promise
        }
      }
    })
    const stream = await host.openStream('produce', 10, options)
    await flushMicrotasks()
    let closed = false
    const cancelled = stream.cancel().then(() => {
      closed = true
    })
    await expect(stream.completed).rejects.toMatchObject({ name: 'AbortError' })
    await expect(stream.output[Symbol.asyncIterator]().next()).rejects.toMatchObject({ name: 'AbortError' })
    await vi.advanceTimersByTimeAsync(500)
    expect(closed).toBe(false)
    expect(adapter.spawns[0].child.exited).toBe(false)
    gate.resolve()
    await cancelled
    expect(closed).toBe(true)
    await expect(host.request('ping', undefined)).resolves.toBe('pong')
  })

  it('releases unread output when the consumer returns after handler closure', async () => {
    const { host } = setup()
    const stream = await host.openStream('produce', 1, options)
    await stream.completed
    await stream.closed
    const reader = stream.output[Symbol.asyncIterator]()
    await reader.return!()
    await expect(reader.next()).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('cancels an output iterator returned before its first next', async () => {
    const { host } = setup()
    const stream = await host.openStream('produce', 100, options)
    await stream.output[Symbol.asyncIterator]().return!()
    await expect(stream.completed).rejects.toMatchObject({ name: 'AbortError' })
    await stream.closed
  })

  it('settles blocked input writes on crash and allows a fresh generation', async () => {
    const { host, adapter } = setup({ duplex: async () => new Promise<number>(() => {}) })
    const stream = await host.openStream('duplex', undefined, options)
    await stream.write(frame(1))
    await stream.write(frame(2))
    const blocked = stream.write(frame(3))
    adapter.spawns[0].child.exit(9)
    await expect(blocked).rejects.toMatchObject({ code: 'PROCESS_EXITED' })
    await expect(stream.completed).rejects.toMatchObject({ code: 'PROCESS_EXITED' })
    await stream.closed
    await expect(host.request('ping', undefined)).resolves.toBe('pong')
    expect(adapter.spawns).toHaveLength(2)
  })

  it('does not equate a terminate request with an observed exit', async () => {
    const { host, adapter } = setup({ produce: async () => new Promise<number>(() => {}) }, 'terminate')
    const stream = await host.openStream('produce', 1, options)
    const child = adapter.spawns[0].child
    child.onKill(() => {})
    let closed = false
    const cancelled = stream.cancel().then(() => {
      closed = true
    })
    await flushMicrotasks()
    expect(closed).toBe(false)
    await expect(stream.completed).rejects.toMatchObject({ name: 'AbortError' })
    child.exit(143)
    await cancelled
    expect(closed).toBe(true)
  })

  it('maintenance starts after exit even when a streaming handler ignores cancellation', async () => {
    vi.useFakeTimers()
    const { host, adapter } = setup({ produce: async () => new Promise<number>(() => {}) })
    const stream = await host.openStream('produce', 1, options)
    let observedExit = false
    const maintenance = host.withStopped(() => {
      observedExit = adapter.spawns[0].child.exited
    })
    await flushMicrotasks()
    expect(observedExit).toBe(false)
    await vi.advanceTimersByTimeAsync(1000)
    await maintenance
    await stream.closed
    expect(observedExit).toBe(true)
    await expect(stream.completed).rejects.toThrow('stopping')
  })

  it('rejects protocol data over the declared capacity and waits for exit to close', async () => {
    const { host, adapter } = setup({ produce: async () => new Promise<number>(() => {}) })
    const stream = await host.openStream('produce', 1, options)
    adapter.spawns[0].child.reply({
      kind: 'stream-data',
      requestId: 1,
      sequence: 1,
      metadata: '{}',
      payload: new Uint8Array(33)
    })
    await expect(stream.completed).rejects.toMatchObject({ code: 'PROCESS_PROTOCOL_ERROR' })
    await stream.closed
    expect(adapter.spawns[0].child.exited).toBe(true)
  })

  it('rejects aborted startup without registering a stream', async () => {
    const { host, adapter } = setup()
    const controller = new AbortController()
    const starting = host.openStream('produce', 1, { ...options, signal: controller.signal })
    controller.abort(new Error('cancel startup'))
    await expect(starting).rejects.toThrow('cancel startup')
    await waitUntil(() => adapter.spawns.length > 0)
    expect(adapter.spawns[0].child.frames.filter((item) => item.kind === 'stream-open')).toEqual([])
  })
})
