import { Worker } from 'node:worker_threads'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { runForkWorker } from '../runWorker'

afterEach(() => vi.useRealTimers())

describe('runForkWorker', () => {
  it('returns opaque results only after the worker has stopped', async () => {
    const worker = new Worker(
      `require('node:worker_threads').parentPort.postMessage({ result: { native: { cursor: [1, 'two'] } } }); setInterval(() => {}, 1000)`,
      { eval: true }
    )
    await expect(runForkWorker(worker, new AbortController().signal)).resolves.toEqual({
      native: { cursor: [1, 'two'] }
    })
    expect(worker.threadId).toBe(-1)
  })

  it.each([
    [
      "require('node:worker_threads').parentPort.postMessage({ error: 'history_changed' }); setInterval(() => {}, 1000)",
      'history_changed'
    ],
    ["throw new Error('native failure')", 'native failure'],
    ['process.exit(0)', 'Fork worker exited without a result']
  ])('rejects a failed worker and waits for its exit: %s', async (source, message) => {
    const worker = new Worker(source, { eval: true })
    await expect(runForkWorker(worker, new AbortController().signal)).rejects.toThrow(message)
    expect(worker.threadId).toBe(-1)
  })

  it.each([true, false])(
    'stops the worker before rejecting cancellation (already aborted: %s)',
    async (alreadyAborted) => {
      const worker = new Worker('setInterval(() => {}, 1000)', { eval: true })
      const controller = new AbortController()
      const reason = new Error('operation cancelled')
      if (alreadyAborted) controller.abort(reason)
      const result = runForkWorker(worker, controller.signal)
      const rejected = expect(result).rejects.toBe(reason)
      if (!alreadyAborted) controller.abort(reason)
      await rejected
      expect(worker.threadId).toBe(-1)
    }
  )

  it('stops a timed-out worker before returning control to the caller', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const worker = new Worker('setInterval(() => {}, 1000)', { eval: true })
    const result = runForkWorker(worker, new AbortController().signal)
    const rejected = expect(result).rejects.toThrow('Fork worker timed out')
    await vi.advanceTimersByTimeAsync(60_000)
    await rejected
    expect(worker.threadId).toBe(-1)
  })
})
