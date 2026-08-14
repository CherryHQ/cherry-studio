/**
 * 面板泳道。新增泳道 = 在这里加一个成员 + 在 resources/devtools/main-perf/panel.js
 * 的 TRACKS 里补图标。
 */
export type PerfTrack = 'bootstrap' | 'ipc' | 'db' | 'dataapi' | 'window' | 'custom'

/** 附加信息，必须是 JSON 可序列化的值。 */
export type PerfDetail = Record<string, unknown>

export interface PerfSpanHandle {
  readonly id: string
  /** 重复调用是无操作。detail 与 start 时的 detail 浅合并。 */
  end(detail?: PerfDetail): void
}

export interface PerfStartOptions {
  /** 归属泳道，决定面板里的分组。默认 'custom'。 */
  track?: PerfTrack
  /** 父 span 句柄，用于在面板中还原层级。不传即为该 track 的顶层。 */
  parent?: PerfSpanHandle
  detail?: PerfDetail
}

export interface PerfSpan {
  id: string
  name: string
  track: PerfTrack
  parentId?: string
  /** ms since timeOrigin，与 perf_hooks 同基准 */
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
