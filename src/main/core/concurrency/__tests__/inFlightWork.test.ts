import { describe, expect, it } from 'vitest'

import { createInFlightWorkTracker } from '../inFlightWork'

describe('createInFlightWorkTracker', () => {
  it('drain resolves true once all tracked work settles', async () => {
    const tracker = createInFlightWorkTracker()
    tracker.track(Promise.resolve('a'))
    tracker.track(
      new Promise((resolve) => {
        setTimeout(resolve, 10)
      })
    )

    await expect(tracker.drain()).resolves.toBe(true)
  })

  it('drain follows work enqueued by settling work', async () => {
    const tracker = createInFlightWorkTracker()
    tracker.track(
      Promise.resolve().then(() => {
        tracker.track(Promise.resolve('follow-up'))
      })
    )

    await expect(tracker.drain()).resolves.toBe(true)
  })

  it('drain returns false at the deadline instead of waiting forever', async () => {
    // A producer still live during shutdown (or a never-settling promise) must
    // not stall a service's stop() — the drain is deadline-bounded.
    const tracker = createInFlightWorkTracker()
    tracker.track(new Promise(() => {}))

    await expect(tracker.drain({ timeoutMs: 50 })).resolves.toBe(false)
  })
})
