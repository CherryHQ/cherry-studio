/**
 * In-flight work tracker for lifecycle-owned background promises. Producers
 * `track` fire-and-forget work; a service's `onStop` `drain`s until quiescent
 * (settling work may enqueue follow-ups, so the drain loops). Rejections are
 * the producer's responsibility — the tracker only observes settlement.
 */
export type InFlightWorkTracker = {
  track: <T>(work: Promise<T>) => Promise<T>
  drain: () => Promise<void>
}

export function createInFlightWorkTracker(): InFlightWorkTracker {
  const inFlight = new Set<Promise<unknown>>()
  return {
    track(work) {
      inFlight.add(work)
      const done = () => inFlight.delete(work)
      void work.then(done, done)
      return work
    },
    async drain() {
      while (inFlight.size > 0) {
        await Promise.allSettled([...inFlight])
      }
    }
  }
}
