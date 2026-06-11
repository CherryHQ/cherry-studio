import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { withIdleTimeout } from '../withIdleTimeout'

/**
 * Build a controllable ReadableStream plus helpers to push / close / error it.
 * The tests use this instead of a real AI SDK stream so we can drive the idle
 * timer precisely with `vi.advanceTimersByTime`.
 */
function makeControllableStream<T>() {
  let controller!: ReadableStreamDefaultController<T>
  const stream = new ReadableStream<T>({
    start(c) {
      controller = c
    }
  })
  return {
    stream,
    push: (v: T) => controller.enqueue(v),
    close: () => controller.close(),
    error: (e: unknown) => controller.error(e)
  }
}

async function readAll<T>(stream: ReadableStream<T>): Promise<T[]> {
  const reader = stream.getReader()
  const out: T[] = []
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) return out
      out.push(value)
    }
  } finally {
    reader.releaseLock()
  }
}

describe('withIdleTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('passes chunks through when chunks arrive within the timeout', async () => {
    const src = makeControllableStream<number>()
    const controller = new AbortController()

    const out = withIdleTimeout(src.stream, controller, 1000)
    const reader = out.getReader()

    src.push(1)
    expect((await reader.read()).value).toBe(1)

    vi.advanceTimersByTime(500) // not idle yet
    src.push(2)
    expect((await reader.read()).value).toBe(2)

    src.close()
    expect((await reader.read()).done).toBe(true)
    expect(controller.signal.aborted).toBe(false)
  })

  it('aborts the controller when no chunk arrives within `timeoutMs`', async () => {
    const src = makeControllableStream<number>()
    const controller = new AbortController()

    const out = withIdleTimeout(src.stream, controller, 1000)
    const reader = out.getReader()

    // Kick the pull so the timer is running against an actually-pending read.
    const firstRead = reader.read()
    src.push(1)
    expect((await firstRead).value).toBe(1)

    vi.advanceTimersByTime(1001)
    expect(controller.signal.aborted).toBe(true)
    expect((controller.signal.reason as DOMException).name).toBe('TimeoutError')
  })

  it('resets the timer on every chunk', async () => {
    const src = makeControllableStream<number>()
    const controller = new AbortController()

    const out = withIdleTimeout(src.stream, controller, 1000)
    const reader = out.getReader()

    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(800) // under the timeout each iteration
      src.push(i)
      await reader.read()
    }

    // Total elapsed = 4000 ms, but no idle gap ≥ 1000 ms, so no abort.
    expect(controller.signal.aborted).toBe(false)
  })

  it('does not re-abort a controller that is already aborted by the caller', async () => {
    const src = makeControllableStream<number>()
    const controller = new AbortController()
    const externalReason = new Error('user cancelled')
    controller.abort(externalReason)

    const out = withIdleTimeout(src.stream, controller, 1000)
    // Idle would normally fire, but the controller is already aborted — the
    // wrapper must not overwrite the reason.
    vi.advanceTimersByTime(5000)
    expect(controller.signal.reason).toBe(externalReason)

    // Close to unblock anyone reading.
    src.close()
    void readAll(out).catch(() => {})
  })

  it('propagates upstream errors and cleans up the timer', async () => {
    const src = makeControllableStream<number>()
    const controller = new AbortController()

    const out = withIdleTimeout(src.stream, controller, 1000)
    const reader = out.getReader()

    src.push(1)
    await reader.read()

    const boom = new Error('provider blew up')
    src.error(boom)

    await expect(reader.read()).rejects.toBe(boom)

    // Timer must have been cleaned up — advancing time should not abort.
    vi.advanceTimersByTime(5000)
    expect(controller.signal.aborted).toBe(false)
  })

  it('cleans up the timer on downstream cancel', async () => {
    const src = makeControllableStream<number>()
    const controller = new AbortController()

    const out = withIdleTimeout(src.stream, controller, 1000)
    const reader = out.getReader()

    src.push(1)
    await reader.read()

    await reader.cancel('caller gave up')

    vi.advanceTimersByTime(5000)
    expect(controller.signal.aborted).toBe(false)
  })
})
