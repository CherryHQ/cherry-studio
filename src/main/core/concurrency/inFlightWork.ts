/**
 * In-flight work tracker for lifecycle-owned background promises. Producers
 * `track` fire-and-forget work; a service's `onStop` `drain`s until quiescent
 * (settling work may enqueue follow-ups, so the drain loops). Rejections are
 * the producer's responsibility — the tracker only observes settlement.
 */
export type InFlightWorkTracker = {
  track: <T>(work: Promise<T>) => Promise<T>
  /**
   * Wait out the tracked work, looping while settling work enqueues
   * follow-ups. Bounded by `timeoutMs` so a producer still live during
   * shutdown cannot stall `stop()` forever; returns false when the deadline
   * was hit with work still in flight.
   */
  drain: (options?: { timeoutMs?: number }) => Promise<boolean>
}

const DEFAULT_DRAIN_TIMEOUT_MS = 15_000

export function createInFlightWorkTracker(): InFlightWorkTracker {
  const inFlight = new Set<Promise<unknown>>()
  return {
    track(work) {
      inFlight.add(work)
      const done = () => inFlight.delete(work)
      void work.then(done, done)
      return work
    },
    async drain({ timeoutMs = DEFAULT_DRAIN_TIMEOUT_MS } = {}) {
      const deadline = Date.now() + timeoutMs
      while (inFlight.size > 0) {
        const remaining = deadline - Date.now()
        if (remaining <= 0) return false
        // Race the settle round against the deadline: awaiting allSettled
        // alone would block forever on a never-settling promise.
        let timer: ReturnType<typeof setTimeout> | undefined
        try {
          const round = await Promise.race([
            Promise.allSettled([...inFlight]).then(() => 'settled' as const),
            new Promise<'timeout'>((resolve) => {
              timer = setTimeout(() => resolve('timeout'), remaining)
            })
          ])
          if (round === 'timeout') return false
        } finally {
          clearTimeout(timer)
        }
      }
      return true
    }
  }
}
