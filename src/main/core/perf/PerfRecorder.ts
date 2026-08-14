import { DIAGNOSTICS_ENABLED } from '@main/core/diagnostics'
import { Emitter, type Event } from '@main/core/lifecycle'

import type { PerfDetail, PerfSpan, PerfSpanHandle, PerfStartOptions, PerfTrack } from './types'

const DEFAULT_MAX_SPANS = 5000
const DEFAULT_TRACK: PerfTrack = 'custom'

/** 关闭时返回的共享句柄：不分配对象、不读时钟、不生成 id。 */
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
 * 扁平 span + 可选父引用的埋点内核。完成的 span 有两个出口：自有环形缓冲
 * （供 Main Perf 面板）与 Node 标准 timeline（供 `--inspect` 下的原生 Performance 面板）。
 */
export class PerfRecorder {
  readonly enabled: boolean

  private readonly maxSpans: number
  private readonly now: () => number
  /**
   * 懒建：LifecycleManager 依赖 perf，而 perf 从 lifecycle barrel 取 Emitter，构成
   * 循环导入。把 Emitter 的解引用推迟到订阅时，就不依赖 barrel 里的声明顺序。
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
   * detail 走结构化克隆，含函数等不可克隆值时整条 measure 都不会写入 —— 退回不带
   * detail 再写一次，保证 timeline 不因附加信息而丢条目。
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
        // timeline 是附加出口，写不进去也不该影响采集。
      }
    }
  }
}

/**
 * 直接读 env 而非 `isDev` from `@main/core/platform`：本模块被 lifecycle 基座导入，
 * 模块求值时读任何外部模块的导出，都会变成每个服务测试的 partial mock 的必填项。
 * `diagnostics.ts` 自读 `CS_DIAGNOSTICS` 是同一个理由。
 */
const PERF_ENABLED = process.env.NODE_ENV === 'development' || DIAGNOSTICS_ENABLED

export const perf = new PerfRecorder({ enabled: PERF_ENABLED })
