/**
 * Bytes-per-second estimates for running downloads.
 *
 * The transfer engine reports cumulative bytes on the same flush that persists
 * progress (about once a second by default), so a rate only exists once two
 * samples are far enough apart to measure. Rates are smoothed so that a segment
 * finishing and another taking over does not read as a spike or a stall.
 */

/** Samples closer together than this reuse the previous rate instead of dividing by noise. */
const MIN_SAMPLE_MS = 250
/** A task that has not reported for this long is not transferring, whatever it says. */
const STALE_AFTER_MS = 5_000
/** Weight of the newest sample; the rest keeps the previous estimate. */
const SMOOTHING = 0.4

interface Sample {
  bytes: number
  at: number
}

export class SpeedMeter {
  private readonly samples = new Map<string, Sample>()
  private readonly rates = new Map<string, number>()

  /** Records a cumulative byte count and returns the smoothed bytes per second. */
  update(taskId: string, bytes: number, now = Date.now()): number {
    const previous = this.samples.get(taskId)
    if (!previous) {
      this.samples.set(taskId, { bytes, at: now })
      return 0
    }
    // A retry can reset the task to zero; the old baseline would produce a negative delta.
    if (bytes < previous.bytes) {
      this.samples.set(taskId, { bytes, at: now })
      this.rates.delete(taskId)
      return 0
    }
    const elapsed = now - previous.at
    if (elapsed < MIN_SAMPLE_MS) return this.rates.get(taskId) ?? 0

    const instant = ((bytes - previous.bytes) * 1000) / elapsed
    const previousRate = this.rates.get(taskId)
    const rate = previousRate === undefined ? instant : previousRate * (1 - SMOOTHING) + instant * SMOOTHING
    this.samples.set(taskId, { bytes, at: now })
    this.rates.set(taskId, rate)
    return rate
  }

  /** Last measured rate, or zero when the task stopped reporting. */
  get(taskId: string, now = Date.now()): number {
    const sample = this.samples.get(taskId)
    if (!sample || now - sample.at > STALE_AFTER_MS) return 0
    return this.rates.get(taskId) ?? 0
  }

  /** Drops a task once it is no longer transferring, so a later resume starts clean. */
  stop(taskId: string): void {
    this.samples.delete(taskId)
    this.rates.delete(taskId)
  }
}
