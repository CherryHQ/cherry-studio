import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { STOP_TOTAL_MS } from '../protocol/constants'
import type { MainFrame } from '../protocol/frames'
import { isUtilityProcessError, type UtilityProcessError, type UtilityProcessErrorCode } from '../UtilityProcessError'
import { createHost, echoScript, expectRejected } from './hostTestUtils'
import { flushMicrotasks, type MemoryChild, type MemoryChildScript, waitUntil } from './memoryProcessAdapter'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

function expectCode(error: unknown, code: UtilityProcessErrorCode): UtilityProcessError {
  expect(isUtilityProcessError(error, code), `expected ${code}, got ${String(error)}`).toBe(true)
  return error as UtilityProcessError
}

const exitBeforeReady: MemoryChildScript = (child) => {
  void child.awaitConnect().then(() => child.exit(1))
}

function scriptedReady(onRequest: (child: MemoryChild, frame: MainFrame) => void): MemoryChildScript {
  return (child) => {
    child.onFrame((frame) => onRequest(child, frame))
    void child.awaitConnect().then(() => child.reply({ kind: 'ready' }))
  }
}

/** Runs `scripts[index]` for the matching spawn and the echo runtime once they run out. */
function sequence(...scripts: MemoryChildScript[]): MemoryChildScript {
  const echo = echoScript().script
  return (child, index, options) => (scripts[index] ?? echo)(child, index, options)
}

describe('ProcessHost circuit breaker', () => {
  it('opens after three consecutive start failures and refuses to spawn while open', async () => {
    const { host, adapter } = createHost({ script: exitBeforeReady })

    const first = await expectRejected(host.request('ping', undefined), (error) =>
      expectCode(error, 'PROCESS_START_FAILED')
    )
    const second = await expectRejected(host.request('ping', undefined), (error) =>
      expectCode(error, 'PROCESS_START_FAILED')
    )
    const third = await expectRejected(host.request('ping', undefined), (error) =>
      expectCode(error, 'PROCESS_START_FAILED')
    )
    expect([first.failureCount, second.failureCount, third.failureCount]).toEqual([1, 2, 3])
    expect([first.circuitOpen, second.circuitOpen, third.circuitOpen]).toEqual([false, false, true])

    await expectRejected(host.request('ping', undefined), (error) => expectCode(error, 'PROCESS_CIRCUIT_OPEN'))
    expect(adapter.spawns).toHaveLength(3)
  })

  it('resets the count on any terminal, including a handler error', async () => {
    const { host } = createHost({ script: sequence(exitBeforeReady, exitBeforeReady) })
    await expectRejected(host.request('ping', undefined))
    await expectRejected(host.request('ping', undefined))

    const remote = await expectRejected(host.request('fail', undefined), (error) =>
      expectCode(error, 'PROCESS_REMOTE_ERROR')
    )
    expect(remote.remote?.code).toBe('E_HANDLER')

    const crashed = expectRejected(host.request('crash', undefined), (error) => expectCode(error, 'PROCESS_EXITED'))
    await vi.advanceTimersByTimeAsync(0)
    const error = await crashed
    expect(error.failureCount).toBe(1)
    expect(error.circuitOpen).toBe(false)
  })

  it('opens the circuit after three crashes even when a handler unwinds during each crash', async () => {
    const { script, states } = echoScript()
    const { host } = createHost({ script })
    const errors: UtilityProcessError[] = []

    for (let round = 0; round < 3; round += 1) {
      const waiting = expectRejected(host.request('wait', undefined), (error) => expectCode(error, 'PROCESS_EXITED'))
      await waitUntil(() => states[round]?.waitSignals.length === 1, 'wait handler started')
      const crashed = expectRejected(host.request('crash', undefined), (error) => expectCode(error, 'PROCESS_EXITED'))
      await vi.advanceTimersByTimeAsync(0)
      errors.push(await waiting, await crashed)
    }

    expect(errors.map((error) => error.failureCount)).toEqual([1, 1, 2, 2, 3, 3])
    expect(errors.at(-1)?.circuitOpen).toBe(true)
    await expectRejected(host.request('ping', undefined), (error) => expectCode(error, 'PROCESS_CIRCUIT_OPEN'))
  })

  it('counts unrequested clean exits and protocol violations', async () => {
    const exitZeroOnRequest = scriptedReady((child, frame) => {
      if (frame.kind === 'request') child.exit(0)
    })
    const malformedOnRequest = scriptedReady((child, frame) => {
      if (frame.kind === 'request') child.post({ nope: true })
    })
    const { host, adapter } = createHost({ script: sequence(exitZeroOnRequest, malformedOnRequest, exitZeroOnRequest) })

    await expectRejected(host.request('ping', undefined))
    await expectRejected(host.request('ping', undefined))
    const third = await expectRejected(host.request('ping', undefined), (error) => expectCode(error, 'PROCESS_EXITED'))

    expect(third.circuitOpen).toBe(true)
    await expectRejected(host.request('ping', undefined), (error) => expectCode(error, 'PROCESS_CIRCUIT_OPEN'))
    expect(adapter.spawns).toHaveLength(3)
  })

  it('counts at most one failure per generation however many bad frames it emits', async () => {
    const floodOnRequest = scriptedReady((child, frame) => {
      if (frame.kind !== 'request') return
      child.post({ nope: 1 })
      child.post({ nope: 2 })
      child.reply({ kind: 'protocol-error', message: 'again' })
    })
    const { host } = createHost({ script: sequence(exitBeforeReady, exitBeforeReady, floodOnRequest) })
    await expectRejected(host.request('ping', undefined))
    await expectRejected(host.request('ping', undefined))

    const error = await expectRejected(host.request('ping', undefined), (error) =>
      expectCode(error, 'PROCESS_PROTOCOL_ERROR')
    )
    await flushMicrotasks()

    expect(error.failureCount).toBe(3)
  })

  it('does not count stop or idle exits', async () => {
    const { host, adapter } = createHost({ definition: { idleTimeoutMs: 100 } })

    for (let round = 0; round < 3; round += 1) {
      await host.request('ping', undefined)
      await host.stop()
    }
    for (let round = 0; round < 3; round += 1) {
      await host.request('ping', undefined)
      await vi.advanceTimersByTimeAsync(100)
    }

    await expect(host.request('ping', undefined)).resolves.toBe('pong')
    expect(adapter.spawns).toHaveLength(7)
  })

  it('reopens after stop({ resetFailures: true })', async () => {
    const { host } = createHost({ script: sequence(exitBeforeReady, exitBeforeReady, exitBeforeReady) })
    for (let round = 0; round < 3; round += 1) await expectRejected(host.request('ping', undefined))
    await expectRejected(host.request('ping', undefined), (error) => expectCode(error, 'PROCESS_CIRCUIT_OPEN'))

    await host.stop({ resetFailures: true })

    await expect(host.request('ping', undefined)).resolves.toBe('pong')
  })

  it('reopens through withStopped only when the operation succeeds', async () => {
    const { host } = createHost({ script: sequence(exitBeforeReady, exitBeforeReady, exitBeforeReady) })
    for (let round = 0; round < 3; round += 1) await expectRejected(host.request('ping', undefined))

    await expectRejected(
      host.withStopped(
        () => {
          throw new Error('repair failed')
        },
        { resetFailures: true }
      )
    )
    await expectRejected(host.request('ping', undefined), (error) => expectCode(error, 'PROCESS_CIRCUIT_OPEN'))

    await host.withStopped(() => 'repaired', { resetFailures: true })
    await expect(host.request('ping', undefined)).resolves.toBe('pong')
  })

  it('keeps the circuit open when a resetting stop times out', async () => {
    const stuckAndMalformed: MemoryChildScript = (child, index, options) => {
      child.onKill(() => {})
      void scriptedReady((c, frame) => {
        if (frame.kind === 'request') c.post({ nope: true })
      })(child, index, options)
    }
    const { host, adapter } = createHost({ script: sequence(exitBeforeReady, exitBeforeReady, stuckAndMalformed) })
    for (let round = 0; round < 2; round += 1) await expectRejected(host.request('ping', undefined))
    const opened = await expectRejected(host.request('ping', undefined), (error) =>
      expectCode(error, 'PROCESS_PROTOCOL_ERROR')
    )
    expect(opened.circuitOpen).toBe(true)

    const stopping = expectRejected(host.stop({ resetFailures: true }), (error) =>
      expectCode(error, 'PROCESS_STOP_FAILED')
    )
    await vi.advanceTimersByTimeAsync(STOP_TOTAL_MS)

    await stopping
    await expectRejected(host.request('ping', undefined), (error) => expectCode(error, 'PROCESS_CIRCUIT_OPEN'))
    expect(adapter.spawns).toHaveLength(3)
  })
})
