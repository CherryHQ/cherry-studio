import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { REQUEST_CANCELLED_CODE } from '../protocol/constants'
import type { MainFrame } from '../protocol/frames'
import { isUtilityProcessError, type UtilityProcessError, type UtilityProcessErrorCode } from '../UtilityProcessError'
import { createHost, echoScript, rejectionOf } from './hostTestUtils'
import { flushMicrotasks, type MemoryChild, type MemoryChildScript, waitUntil } from './memoryProcessAdapter'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

function expectCode(error: unknown, code: UtilityProcessErrorCode): UtilityProcessError {
  expect(isUtilityProcessError(error, code), `expected ${code}, got ${String(error)}`).toBe(true)
  return error as UtilityProcessError
}

function scriptedReady(onRequest: (child: MemoryChild, frame: MainFrame) => void): MemoryChildScript {
  return (child) => {
    child.onFrame((frame) => onRequest(child, frame))
    void child.awaitConnect().then(() => child.reply({ kind: 'ready' }))
  }
}

/** Uses the scripted child for the first generation and the real echo runtime afterwards. */
function firstThenEcho(first: MemoryChildScript): MemoryChildScript {
  const echo = echoScript().script
  return (child, index, options) => (index === 0 ? first(child, index, options) : echo(child, index, options))
}

describe('ProcessHost cancellation (cooperative)', () => {
  it('rejects with the caller reason immediately, aborts the child handler, and keeps the generation', async () => {
    const { script, states } = echoScript()
    const { host, adapter } = createHost({ script })
    const controller = new AbortController()
    const reason = new Error('caller gave up')

    const pending = host.request('wait', undefined, { signal: controller.signal })
    await waitUntil(() => states[0].waitSignals.length === 1, 'handler started')
    controller.abort(reason)

    expect(await rejectionOf(pending)).toBe(reason)
    await waitUntil(() => states[0].waitSignals[0].aborted, 'child abort')
    expect((states[0].waitSignals[0].reason as { code: string }).code).toBe(REQUEST_CANCELLED_CODE)

    await flushMicrotasks()
    await expect(host.request('ping', undefined)).resolves.toBe('pong')
    expect(adapter.spawns).toHaveLength(1)
  })

  it('never spawns for an already aborted signal', async () => {
    const { host, adapter } = createHost()
    const controller = new AbortController()
    const reason = new Error('too late')
    controller.abort(reason)

    expect(await rejectionOf(host.request('ping', undefined, { signal: controller.signal }))).toBe(reason)
    expect(adapter.spawns).toHaveLength(0)
  })

  it('releases a caller that aborts during the cold start while the generation keeps serving others', async () => {
    const { host, adapter } = createHost()
    const controller = new AbortController()
    const reason = new Error('impatient')

    const aborted = host.request('ping', undefined, { signal: controller.signal })
    const other = host.request('ping', undefined)
    controller.abort(reason)

    expect(await rejectionOf(aborted)).toBe(reason)
    await expect(other).resolves.toBe('pong')
    expect(adapter.spawns).toHaveLength(1)
    expect(adapter.spawns[0].child.killed).toBe(false)
  })

  it('delivers events synchronously in order before the result', async () => {
    const { host } = createHost()
    const order: string[] = []

    const result = await host.request('stream', 3, { onEvent: (event) => order.push(`event-${event}`) })
    order.push(result)

    expect(order).toEqual(['event-1', 'event-2', 'event-3', 'done'])
  })

  it('cancels the request with the callback error when onEvent throws', async () => {
    const { host, adapter } = createHost()
    const seen: number[] = []
    const failure = new Error('bad event')

    const pending = host.request('stream', 3, {
      onEvent: (event) => {
        seen.push(event)
        if (event === 2) throw failure
      }
    })

    expect(await rejectionOf(pending)).toBe(failure)
    expect(seen).toEqual([1, 2])
    await expect(host.request('ping', undefined)).resolves.toBe('pong')
    expect(adapter.spawns).toHaveLength(1)
  })

  it('rejects an unclonable input with PROCESS_SERIALIZATION_FAILED and leaves the generation usable', async () => {
    const { host, adapter } = createHost()

    expectCode(await rejectionOf(host.request('echo', () => 1)), 'PROCESS_SERIALIZATION_FAILED')

    await expect(host.request('ping', undefined)).resolves.toBe('pong')
    expect(adapter.spawns).toHaveLength(1)
  })
})

describe('ProcessHost cancellation (terminate)', () => {
  it('kills the generation, releases the canceller only after the exit, and fails other callers as intentional', async () => {
    const { script, states } = echoScript()
    const { host, adapter } = createHost({ script, definition: { cancellation: 'terminate' } })
    const controller = new AbortController()
    const reason = new Error('stop the native call')
    let exitedWhenRejected: boolean | null = null

    const cancelled = host.request('wait', undefined, { signal: controller.signal })
    const bystander = host.request('wait', undefined)
    await waitUntil(() => states[0].waitSignals.length === 2, 'both handlers started')
    const child = adapter.spawns[0].child
    void cancelled.catch(() => {
      exitedWhenRejected = child.exited
    })
    controller.abort(reason)

    expect(await rejectionOf(cancelled)).toBe(reason)
    expect(exitedWhenRejected).toBe(true)
    expect(child.killed).toBe(true)
    const error = expectCode(await rejectionOf(bystander), 'PROCESS_EXITED')
    expect(error.intentional).toBe(true)
  })

  it('does not count terminate cancellations as failures', async () => {
    const { script, states } = echoScript()
    const { host, adapter } = createHost({ script, definition: { cancellation: 'terminate' } })

    for (let round = 0; round < 3; round += 1) {
      const controller = new AbortController()
      const pending = host.request('wait', undefined, { signal: controller.signal })
      await waitUntil(() => states[round].waitSignals.length === 1, `handler ${round} started`)
      controller.abort(new Error(`cancel ${round}`))
      await rejectionOf(pending)
    }

    await expect(host.request('ping', undefined)).resolves.toBe('pong')
    expect(adapter.spawns).toHaveLength(4)
  })

  it('kills the generation when onEvent throws', async () => {
    const { host, adapter } = createHost({ definition: { cancellation: 'terminate' } })
    const failure = new Error('bad event')

    const pending = host.request('stream', 2, {
      onEvent: () => {
        throw failure
      }
    })

    expect(await rejectionOf(pending)).toBe(failure)
    expect(adapter.spawns[0].child.killed).toBe(true)
    await expect(host.request('ping', undefined)).resolves.toBe('pong')
    expect(adapter.spawns).toHaveLength(2)
  })
})

describe('ProcessHost protocol violations', () => {
  it('fails the generation on a duplicate terminal and serves the next request on a fresh one', async () => {
    const { host, adapter } = createHost({
      script: firstThenEcho(
        scriptedReady((child, frame) => {
          if (frame.kind !== 'request' || frame.method !== 'echo') return
          child.reply({ kind: 'result', requestId: frame.requestId, output: 'first' })
          child.reply({ kind: 'result', requestId: frame.requestId, output: 'second' })
        })
      )
    })

    const bystander = host.request('ping', undefined)
    await expect(host.request('echo', 'x')).resolves.toBe('first')

    expectCode(await rejectionOf(bystander), 'PROCESS_PROTOCOL_ERROR')
    expect(adapter.spawns[0].child.killed).toBe(true)
    await expect(host.request('ping', undefined)).resolves.toBe('pong')
    expect(adapter.spawns).toHaveLength(2)
  })

  it.each([
    [
      'a terminal for an unknown request id',
      (child: MemoryChild) => child.reply({ kind: 'result', requestId: 999, output: 1 })
    ],
    ['a malformed frame', (child: MemoryChild) => child.post({ kind: 'result' })],
    [
      'a frame from another generation',
      (child: MemoryChild) => child.post({ ...child.identity, generation: 99, kind: 'ready' })
    ],
    [
      'a child-reported protocol error',
      (child: MemoryChild) => child.reply({ kind: 'protocol-error', message: 'boom' })
    ]
  ])('rejects pending requests with PROCESS_PROTOCOL_ERROR on %s', async (_label, misbehave) => {
    const { host, adapter } = createHost({
      script: scriptedReady((child, frame) => {
        if (frame.kind === 'request') misbehave(child)
      })
    })

    expectCode(await rejectionOf(host.request('ping', undefined)), 'PROCESS_PROTOCOL_ERROR')
    expect(adapter.spawns[0].child.killed).toBe(true)
  })
})
