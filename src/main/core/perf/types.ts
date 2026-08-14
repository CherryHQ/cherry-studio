/**
 * Panel lane. Adding a lane means adding a member here AND an icon entry in
 * TRACKS in resources/devtools/main-perf/panel.js.
 */
export type PerfTrack = 'bootstrap' | 'ipc' | 'db' | 'dataapi' | 'window' | 'custom'

/** Extra context attached to a span. Must hold JSON-serializable values only. */
export type PerfDetail = Record<string, unknown>

export interface PerfSpanHandle {
  readonly id: string
  /** A second call is a no-op. `detail` is shallow-merged over the one given to `start()`. */
  end(detail?: PerfDetail): void
}

export interface PerfStartOptions {
  /** Lane this span belongs to, which drives panel grouping. Defaults to 'custom'. */
  track?: PerfTrack
  /** Parent handle, used to rebuild hierarchy in the panel. Omit for a lane-level span. */
  parent?: PerfSpanHandle
  detail?: PerfDetail
}

export interface PerfSpan {
  id: string
  name: string
  track: PerfTrack
  parentId?: string
  /** ms since timeOrigin — the same base as perf_hooks entries. */
  startTime: number
  duration: number
  detail?: PerfDetail
}

export interface MemorySample {
  /** ms since timeOrigin */
  at: number
  heapUsed: number
  heapTotal: number
  rss: number
  external: number
  arrayBuffers: number
}

export interface ProcessMetric {
  pid: number
  type: string
  name?: string
  cpuPercent: number
  memoryKb: number
}
