/**
 * Opt-in performance diagnostics, gated by the `CS_DIAGNOSTICS` env var.
 *
 * Default off → zero overhead in a normal run. When enabled it adds the signals
 * the regular bootstrap summary cannot provide:
 *
 *   1. A V8 CPU profile of the whenReady phase (self-time by function) — the only
 *      reliable attribution when startup runs as one uninterrupted microtask chain.
 *   2. Per-service start/end offsets relative to the phase epoch — reveals that a
 *      whole layer's services share one blocking span (they all "complete" at the
 *      same instant, differing only by start offset).
 *   3. Event-loop lag sampling — a late timer fire measures how long a synchronous
 *      task blocked the loop; zero spikes ⇒ latency is IO/macrotask bound.
 *
 * `DbService` gates its slow-query log on the same flag. Enable everything with
 * `CS_DIAGNOSTICS=1 pnpm dev`.
 */

import { writeFileSync } from 'node:fs'
import { Session } from 'node:inspector'

export const DIAGNOSTICS_ENABLED = !!process.env.CS_DIAGNOSTICS

/** Thresholds (ms) above which a probe logs a slow event. Tune here. */
export const SLOW_THRESHOLD_MS = {
  dbQuery: 15,
  ipcHandler: 50,
  dataApiRequest: 50
} as const

/**
 * Wraps the V8 sampling CPU profiler (via the inspector protocol). Timer-based
 * lag sampling is blind to a pure microtask cascade (the loop never reaches the
 * timers phase, so `fires=0`); a CPU profile attributes self-time by function
 * regardless of microtask interleaving, which is the only way to find the
 * actual CPU consumer when startup runs as one uninterrupted microtask chain.
 */
export class CpuProfiler {
  private session: Session | null = null

  async start(): Promise<void> {
    this.session = new Session()
    this.session.connect()
    await this.post('Profiler.enable')
    // 1000µs (V8 default) — 100µs oversampled ~10x, adding ~135ms of inspector
    // overhead that only taxed the profiled whenReady phase and drowned out sub-100ms deltas.
    await this.post('Profiler.setSamplingInterval', { interval: 1000 })
    await this.post('Profiler.start')
  }

  async stopAndWrite(filePath: string): Promise<void> {
    if (!this.session) return
    try {
      const { profile } = await this.post('Profiler.stop')
      writeFileSync(filePath, JSON.stringify(profile))
    } finally {
      // Always release the inspector session, even if the write fails.
      this.session.disconnect()
      this.session = null
    }
  }

  private post(method: string, params?: Record<string, unknown>): Promise<any> {
    return new Promise((resolve, reject) => {
      this.session!.post(method, params as never, (err, result) => (err ? reject(err) : resolve(result)))
    })
  }
}

/** One service's execution window, measured from the phase epoch. */
export interface ServiceSpan {
  name: string
  /** ms between phase epoch and the moment `_doInit()` started */
  startOffset: number
  /** ms between phase epoch and the moment `_doInit()` resolved */
  endOffset: number
  /** measured `_doInit()` duration in ms */
  duration: number
}

/** A stretch where the event loop was blocked beyond the sampling interval. */
interface LagSpike {
  /** ms since phase epoch when the block started */
  at: number
  /** how long the loop was blocked, in ms */
  lag: number
}

/** Aggregate lag stats across the whole sampling window. */
export interface LagSummary {
  spikes: LagSpike[]
  /** number of timer fires observed */
  fires: number
  /** sum of ALL positive overshoots (even tiny ones) — total time the loop was unavailable */
  totalLag: number
  /** largest single overshoot */
  maxLag: number
  /** wall-clock span the sampler covered */
  span: number
}

/**
 * Samples event-loop lag on a fixed interval. A blocked loop makes the timer
 * fire late; the overshoot beyond `intervalMs` is the lag. Spikes record big
 * single blocks; the aggregate `totalLag` catches blocking fragmented into
 * many sub-threshold chunks (lazy JIT, GC, chatty sync work) that no single
 * spike would reveal. Loop genuinely idle on IO ⇒ totalLag ≈ 0.
 */
export class EventLoopLagSampler {
  private timer: ReturnType<typeof setInterval> | null = null
  private epoch = 0
  private expected = 0
  private fires = 0
  private totalLag = 0
  private maxLag = 0
  private readonly spikes: LagSpike[] = []

  constructor(
    private readonly intervalMs = 4,
    public readonly thresholdMs = 10
  ) {}

  start(epoch: number): void {
    this.epoch = epoch
    this.expected = performance.now() + this.intervalMs
    this.timer = setInterval(() => {
      const now = performance.now()
      const lag = now - this.expected
      if (lag > 0) {
        this.fires++
        this.totalLag += lag
        if (lag > this.maxLag) this.maxLag = lag
        if (lag > this.thresholdMs) this.spikes.push({ at: this.expected - this.epoch, lag })
      } else {
        this.fires++
      }
      this.expected = now + this.intervalMs
    }, this.intervalMs)
    // Never keep the process alive just for the sampler.
    this.timer.unref?.()
  }

  stop(): LagSummary {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    return {
      spikes: this.spikes,
      fires: this.fires,
      totalLag: this.totalLag,
      maxLag: this.maxLag,
      span: performance.now() - this.epoch
    }
  }
}

/** Build a human-readable profile report for one phase. */
export function formatPhaseProfile(phase: string, spans: ServiceSpan[], lag: LagSummary, thresholdMs: number): string {
  const lines: string[] = []
  const nameCol = Math.max(24, ...spans.map((s) => s.name.length))

  lines.push(`[Diagnostics] ${phase} — service spans (sorted by start offset)`)
  for (const s of [...spans].sort((a, b) => a.startOffset - b.startOffset)) {
    lines.push(
      `  ${s.name.padEnd(nameCol)}  start=${s.startOffset.toFixed(1).padStart(8)}ms` +
        `  end=${s.endOffset.toFixed(1).padStart(8)}ms  dur=${s.duration.toFixed(1).padStart(8)}ms`
    )
  }

  // Aggregate lag is the key discriminator: high totalLag ⇒ the loop was busy
  // with sync work (whole or fragmented sub-threshold); near-zero totalLag over
  // a long span ⇒ the loop sat idle waiting on IO / a macrotask.
  lines.push(
    `[Diagnostics] ${phase} — event-loop lag: totalLag=${lag.totalLag.toFixed(1)}ms ` +
      `maxLag=${lag.maxLag.toFixed(1)}ms fires=${lag.fires} span=${lag.span.toFixed(1)}ms ` +
      `(spikes >${thresholdMs}ms: ${lag.spikes.length})`
  )
  for (const sp of [...lag.spikes].sort((a, b) => a.at - b.at)) {
    lines.push(`  blocked=${sp.lag.toFixed(1).padStart(8)}ms  starting at offset=${sp.at.toFixed(1).padStart(8)}ms`)
  }
  return lines.join('\n')
}
