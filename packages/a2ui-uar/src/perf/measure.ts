/**
 * Performance-measurement harness for Change 17's budget:
 *   - initial render < 16ms
 *   - streaming chunk (an `updateComponents`/`updateDataModel` message
 *     applied to an already-mounted surface) < 8ms
 *
 * This module is the *measurement* primitive only — see
 * `test/perf/render-budget.test.tsx` for how it's used against real
 * components, and `test/perf/README.md` for the gap between this and an
 * actual CI-enforced gate.
 */

export interface MeasureResult {
  /** Wall-clock duration in milliseconds, from `performance.now()`. */
  durationMs: number
}

/**
 * Times a synchronous callback with `performance.now()`. Callers are
 * responsible for making sure `fn` actually performs the work being
 * measured synchronously (e.g. `act(() => root.render(...))` for React,
 * which flushes synchronously inside the `act` call in test environments).
 */
export function measure(fn: () => void): MeasureResult {
  const start = performance.now()
  fn()
  const end = performance.now()
  return { durationMs: end - start }
}

/** Runs `fn` `iterations` times and returns every individual duration, so callers can look at p50/p95 instead of a single noisy sample. */
export function measureMany(fn: () => void, iterations: number): MeasureResult[] {
  const results: MeasureResult[] = []
  for (let i = 0; i < iterations; i += 1) {
    results.push(measure(fn))
  }
  return results
}

export function percentile(durationsMs: number[], p: number): number {
  if (durationsMs.length === 0) return 0
  const sorted = [...durationsMs].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[Math.max(0, index)]
}
