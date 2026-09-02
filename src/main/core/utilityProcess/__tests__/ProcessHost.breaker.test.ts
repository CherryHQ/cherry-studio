import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { STOP_TOTAL_MS } from '../protocol/constants'
import type { MainFrame } from '../protocol/frames'
import { isUtilityProcessError, type UtilityProcessError, type UtilityProcessErrorCode } from '../UtilityProcessError'
import { createHost, echoScript, rejectionOf } from './hostTestUtils'
import { flushMicrotasks, type MemoryChild, type MemoryChildScript } from './memoryProcessAdapter'

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

    const first = expectCode(await rejectionOf(host.request('ping', undefined)), 'PROCESS_START_FAILED')
    const second = expectCode(await rejectionOf(host.request('ping', undefined)), 'PROCESS_START_FAILED')
    const third = expectCode(await rejectionOf(host.request('ping', undefined)), 'PROCESS_START_FAILED')
    expect([first.failureCount, second.failureCount, third.failureCount]).toEqual([1, 2, 3])
    expect([first.circuitOpen, second.circuitOpen, third.circuitOpen]).toEqual([false, false, true])

    expectCode(await rejectionOf(host.request('ping', undefined)), 'PROCESS_CIRCUIT_OPEN')
    expect(adapter.spawns).toHaveLength(3)
  })

  it('resets the count on any terminal, including a handler error', async () => {
    const { host } = createHost({ script: sequence(exitBeforeReady, exitBeforeReady) })
    await rejectionOf(host.request('ping', undefined))
    await rejectionOf(host.request('ping', undefined))

    const remote = expectCode(await rejectionOf(host.request('fail', undefined)), 'PROCESS_REMOTE_ERROR')
    expect(remote.remote?.code).toBe('E_HANDLER')

    const crashed = rejectionOf(host.request('crash', undefined))
    await vi.advanceTimersByTimeAsync(0)
    const error = expectCode(await crashed, 'PROCESS_EXITED')
    expect(error.failureCount).toBe(1)
    expect(error.circuitOpen).toBe(false)
  })

  it('counts unrequested clean exits and protocol violations', async () => {
    const exitZeroOnRequest = scriptedReady((child, frame) => {
      if (frame.kind === 'request') child.exit(0)
    })
    const malformedOnRequest = scriptedReady((child, frame) => {
      if (frame.kind === 'request') child.post({ nope: true })
    })
    const { host, adapter } = createHost({ script: sequence(exitZeroOnRequest, malformedOnRequest, exitZeroOnRequest) })

    await rejectionOf(host.request('ping', undefined))
    await rejectionOf(host.request('ping', undefined))
    const third = expectCode(await rejectionOf(host.request('ping', undefined)), 'PROCESS_EXITED')

    expect(third.circuitOpen).toBe(true)
    expectCode(await rejectionOf(host.request('ping', undefined)), 'PROCESS_CIRCUIT_OPEN')
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
    await rejectionOf(host.request('ping', undefined))
    await rejectionOf(host.request('ping', undefined))

    const error = expectCode(await rejectionOf(host.request('ping', undefined)), 'PROCESS_PROTOCOL_ERROR')
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
    for (let round = 0; round < 3; round += 1) await rejectionOf(host.request('ping', undefined))
    expectCode(await rejectionOf(host.request('ping', undefined)), 'PROCESS_CIRCUIT_OPEN')

    await host.stop({ resetFailures: true })

    await expect(host.request('ping', undefined)).resolves.toBe('pong')
  })

  it('reopens through withStopped only when the operation succeeds', async () => {
    const { host } = createHost({ script: sequence(exitBeforeReady, exitBeforeReady, exitBeforeReady) })
    for (let round = 0; round < 3; round += 1) await rejectionOf(host.request('ping', undefined))

    await rejectionOf(
      host.withStopped(
        () => {
          throw new Error('repair failed')
        },
        { resetFailures: true }
      )
    )
    expectCode(await rejectionOf(host.request('ping', undefined)), 'PROCESS_CIRCUIT_OPEN')

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
    for (let round = 0; round < 2; round += 1) await rejectionOf(host.request('ping', undefined))
    const opened = expectCode(await rejectionOf(host.request('ping', undefined)), 'PROCESS_PROTOCOL_ERROR')
    expect(opened.circuitOpen).toBe(true)

    const stopping = rejectionOf(host.stop({ resetFailures: true }))
    await vi.advanceTimersByTimeAsync(STOP_TOTAL_MS)

    expectCode(await stopping, 'PROCESS_STOP_FAILED')
    expectCode(await rejectionOf(host.request('ping', undefined)), 'PROCESS_CIRCUIT_OPEN')
    expect(adapter.spawns).toHaveLength(3)
  })
})
