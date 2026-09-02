import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { STOP_GRACE_MS, STOP_TOTAL_MS } from '../protocol/constants'
import { isUtilityProcessError, type UtilityProcessError, type UtilityProcessErrorCode } from '../UtilityProcessError'
import { createHost, echoScript, rejectionOf } from './hostTestUtils'
import { flushMicrotasks, type MemoryChildScript } from './memoryProcessAdapter'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

function expectCode(error: unknown, code: UtilityProcessErrorCode): UtilityProcessError {
  expect(isUtilityProcessError(error, code), `expected ${code}, got ${String(error)}`).toBe(true)
  return error as UtilityProcessError
}

/** Announces ready, then ignores every frame (including shutdown); kill behaviour is the adapter default. */
const ignoresShutdown: MemoryChildScript = (child) => {
  child.onFrame(() => {})
  void child.awaitConnect().then(() => child.reply({ kind: 'ready' }))
}

/** Ignores shutdown and kill alike: the child only exits when the test calls `exit()`. */
const stuck: MemoryChildScript = (child, index, options) => {
  child.onKill(() => {})
  void ignoresShutdown(child, index, options)
}

function firstThenEcho(first: MemoryChildScript): MemoryChildScript {
  const echo = echoScript().script
  return (child, index, options) => (index === 0 ? first(child, index, options) : echo(child, index, options))
}

describe('ProcessHost stop', () => {
  it('shuts a ready generation down gracefully and runs the child dispose hook once', async () => {
    const { script, states } = echoScript()
    const { host, adapter } = createHost({ script })
    await host.request('ping', undefined)

    await host.stop()

    const child = adapter.spawns[0].child
    expect(child.exitCode).toBe(0)
    expect(child.killed).toBe(false)
    expect(child.frames.filter((frame) => frame.kind === 'shutdown')).toHaveLength(1)
    expect(states[0].disposeCalls).toBe(1)
  })

  it('kills a child that ignores shutdown once the grace period elapses', async () => {
    const { host, adapter } = createHost({ script: ignoresShutdown })
    const orphan = rejectionOf(host.request('ping', undefined))
    await flushMicrotasks()
    const child = adapter.spawns[0].child

    const stopping = host.stop()
    await vi.advanceTimersByTimeAsync(STOP_GRACE_MS - 1)
    expect(child.killed).toBe(false)
    await vi.advanceTimersByTimeAsync(1)

    await expect(stopping).resolves.toBeUndefined()
    expect(child.killed).toBe(true)
    expect(expectCode(await orphan, 'PROCESS_EXITED').intentional).toBe(true)
  })

  it('fails with PROCESS_STOP_FAILED after the total budget and respawns only after the late exit', async () => {
    const { host, adapter } = createHost({ script: firstThenEcho(stuck) })
    const orphan = rejectionOf(host.request('ping', undefined))
    await flushMicrotasks()
    const child = adapter.spawns[0].child

    const stopping = rejectionOf(host.stop())
    await vi.advanceTimersByTimeAsync(STOP_TOTAL_MS)

    expectCode(await stopping, 'PROCESS_STOP_FAILED')
    expectCode(await orphan, 'PROCESS_STOP_FAILED')

    const next = host.request('ping', undefined)
    await flushMicrotasks()
    expect(adapter.spawns).toHaveLength(1)

    child.exit(137)
    await expect(next).resolves.toBe('pong')
    expect(adapter.spawns).toHaveLength(2)
  })

  it('shares one barrier across concurrent stop calls', async () => {
    const { host, adapter } = createHost()
    await host.request('ping', undefined)

    await Promise.all([host.stop(), host.stop(), host.stop()])

    expect(adapter.spawns[0].child.frames.filter((frame) => frame.kind === 'shutdown')).toHaveLength(1)
  })

  it('resolves immediately when nothing is running', async () => {
    const { host, adapter } = createHost()
    await expect(host.stop()).resolves.toBeUndefined()
    expect(adapter.spawns).toHaveLength(0)
  })

  it('kills a starting generation and fails its waiters as an intentional exit', async () => {
    const { host, adapter } = createHost({ script: firstThenEcho(() => {}) })
    const waiting = host.request('ping', undefined)
    await flushMicrotasks()

    await host.stop()

    const error = expectCode(await rejectionOf(waiting), 'PROCESS_EXITED')
    expect(error.intentional).toBe(true)
    expect(adapter.spawns[0].child.killed).toBe(true)
    await expect(host.request('ping', undefined)).resolves.toBe('pong')
  })
})

describe('ProcessHost withStopped', () => {
  it('blocks requests from the moment it is enqueued and runs the operation after the exit', async () => {
    const { host, adapter } = createHost()
    await host.request('ping', undefined)
    const child = adapter.spawns[0].child
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let exitedAtOperation: boolean | null = null

    const maintenance = host.withStopped(async () => {
      exitedAtOperation = child.exited
      await gate
      return 'done'
    })
    const blocked = rejectionOf(host.request('ping', undefined))

    expectCode(await blocked, 'PROCESS_BLOCKED')
    release()
    await expect(maintenance).resolves.toBe('done')
    expect(exitedAtOperation).toBe(true)
    await expect(host.request('ping', undefined)).resolves.toBe('pong')
    expect(adapter.spawns).toHaveLength(2)
  })

  it('serialises concurrent maintenance operations', async () => {
    const { host } = createHost()
    const order: string[] = []
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })

    const first = host.withStopped(async () => {
      order.push('first-start')
      await gate
      order.push('first-end')
    })
    const second = host.withStopped(() => {
      order.push('second')
    })
    await flushMicrotasks()
    release()
    await Promise.all([first, second])

    expect(order).toEqual(['first-start', 'first-end', 'second'])
  })

  it('propagates an operation failure, releases the gate, and leaves the process stopped', async () => {
    const { host, adapter } = createHost()
    await host.request('ping', undefined)

    const failure = await rejectionOf(
      host.withStopped(() => {
        throw new Error('repair failed')
      })
    )

    expect((failure as Error).message).toBe('repair failed')
    expect(adapter.spawns).toHaveLength(1)
    expect(adapter.spawns[0].child.exited).toBe(true)
    await expect(host.request('ping', undefined)).resolves.toBe('pong')
    expect(adapter.spawns).toHaveLength(2)
  })

  it('skips the operation when the inner stop fails', async () => {
    const { host } = createHost({ script: stuck })
    void rejectionOf(host.request('ping', undefined))
    await flushMicrotasks()
    let operationCalls = 0

    const maintenance = rejectionOf(
      host.withStopped(() => {
        operationCalls += 1
      })
    )
    await vi.advanceTimersByTimeAsync(STOP_TOTAL_MS)

    expectCode(await maintenance, 'PROCESS_STOP_FAILED')
    expect(operationCalls).toBe(0)
  })
})

describe('ProcessHost parallel stop', () => {
  it('lets several stuck hosts time out within one budget instead of serially', async () => {
    const first = createHost({ script: stuck })
    const second = createHost({ script: stuck })
    void first.host.request('ping', undefined).catch(() => {})
    void second.host.request('ping', undefined).catch(() => {})
    await flushMicrotasks()

    const outcome = Promise.allSettled([first.host.stop(), second.host.stop()])
    await vi.advanceTimersByTimeAsync(STOP_TOTAL_MS)

    const results = await outcome
    expect(results.map((result) => result.status)).toEqual(['rejected', 'rejected'])
  })
})
