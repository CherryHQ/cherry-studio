import { DIAGNOSTICS_ENABLED } from '@main/core/diagnostics'
import { Emitter, type Event } from '@main/core/lifecycle'

import type { PerfDetail, PerfSpan, PerfSpanHandle, PerfStartOptions, PerfTrack } from './types'

const DEFAULT_MAX_SPANS = 5000
const DEFAULT_TRACK: PerfTrack = 'custom'

/** Shared handle returned while disabled: allocates nothing, reads no clock, mints no id. */
const NOOP_HANDLE: PerfSpanHandle = Object.freeze({
  id: '',
  end() {}
})

interface PerfRecorderOptions {
  enabled: boolean
  maxSpans?: number
  now?: () => number
}

/**
 * Flat spans with an optional parent reference. A completed span has two outlets: this
 * recorder's own ring buffer (feeding the Main Perf panel) and the Node performance
 * timeline (feeding the native Performance panel when attached with `--inspect`).
 */
export class PerfRecorder {
  readonly enabled: boolean

  private readonly maxSpans: number
  private readonly now: () => number
  /**
   * Created lazily. LifecycleManager depends on perf while perf pulls Emitter from the
   * lifecycle barrel, so the two modules form an import cycle; deferring the Emitter
   * dereference to first subscription keeps this independent of the barrel's export order.
   */
  private emitter: Emitter<PerfSpan> | null = null
  readonly onSpan: Event<PerfSpan> = (listener) => (this.emitter ??= new Emitter<PerfSpan>()).event(listener)

  private buffer: PerfSpan[] = []
  private head = 0
  private nextId = 0

  constructor(options: PerfRecorderOptions) {
    this.enabled = options.enabled
    this.maxSpans = options.maxSpans ?? DEFAULT_MAX_SPANS
    this.now = options.now ?? (() => performance.now())
  }

  start(name: string, options?: PerfStartOptions): PerfSpanHandle {
    if (!this.enabled) return NOOP_HANDLE

    const id = `p${this.nextId++}`
    const startTime = this.now()
    const track = options?.track ?? DEFAULT_TRACK
    const parentId = options?.parent?.id || undefined
    const startDetail = options?.detail
    let ended = false

    return {
      id,
      end: (endDetail?: PerfDetail) => {
        if (ended) return
        ended = true
        const detail = startDetail || endDetail ? { ...startDetail, ...endDetail } : undefined
        this.record({ id, name, track, parentId, startTime, duration: this.now() - startTime, detail })
      }
    }
  }

  snapshot(): readonly PerfSpan[] {
    if (this.buffer.length < this.maxSpans) return [...this.buffer]
    return [...this.buffer.slice(this.head), ...this.buffer.slice(0, this.head)]
  }

  clear(): void {
    this.buffer = []
    this.head = 0
  }

  private record(span: PerfSpan): void {
    if (this.buffer.length < this.maxSpans) {
      this.buffer.push(span)
    } else {
      this.buffer[this.head] = span
      this.head = (this.head + 1) % this.maxSpans
    }

    this.writeTimeline(span)
    this.emitter?.fire(span)
  }

  /**
   * `detail` is structured-cloned, and a non-cloneable value (a function, say) drops the
   * whole measure rather than just the detail. Retry without it so the timeline never
   * loses an entry over its optional payload.
   */
  private writeTimeline(span: PerfSpan): void {
    const start = span.startTime
    const end = span.startTime + span.duration
    try {
      performance.measure(span.name, { start, end, detail: span.detail })
    } catch {
      try {
        performance.measure(span.name, { start, end })
      } catch {
        // The timeline is a secondary outlet; failing to write it must not affect collection.
      }
    }
  }
}

/**
 * Reads the env var directly instead of `isDev` from `@main/core/platform`: the lifecycle
 * substrate imports this module, so reading any external module's export at evaluation time
 * would make it a required key in every service test's partial mock. `diagnostics.ts` reads
 * `CS_DIAGNOSTICS` itself for the same reason.
 */
const PERF_ENABLED = process.env.NODE_ENV === 'development' || DIAGNOSTICS_ENABLED

export const perf = new PerfRecorder({ enabled: PERF_ENABLED })
