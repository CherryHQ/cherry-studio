import type { SpanEntity } from '@mcp-trace/trace-core/types/config'

export interface TraceSpanMeta {
  topicId?: string
  modelName?: string
}

export interface TraceSpanQuery {
  topicId?: string
  traceId: string
  modelName?: string
}

/**
 * Default cap on the total number of spans held in memory. When exceeded, the oldest
 * fully-ended trace is evicted (see {@link TraceSpanStore.enforceSpanLimit}). In-flight
 * traces are never evicted, so this bound prevents an abandoned trace that never reaches
 * a terminal flush from growing memory without bound, while preserving correctness for
 * traces that are still streaming.
 */
const DEFAULT_MAX_SPANS = 50_000

export class TraceSpanStore {
  private readonly traceMeta = new Map<string, TraceSpanMeta>()
  private readonly spans = new Map<string, SpanEntity>()
  // Per-trace span-id index, used for O(span-count) eviction without scanning all spans.
  private readonly traceSpanIds = new Map<string, Set<string>>()
  // Per-trace recency counter; lower values are older. Bumped on every setSpan.
  private readonly traceOrder = new Map<string, number>()
  private orderSeq = 0

  constructor(private readonly maxSpans = DEFAULT_MAX_SPANS) {}

  registerTraceMeta(traceId: string, meta: TraceSpanMeta): void {
    const current = this.traceMeta.get(traceId) ?? {}
    this.traceMeta.set(traceId, {
      topicId: meta.topicId ?? current.topicId,
      modelName: meta.modelName ?? current.modelName
    })
  }

  getTraceMeta(traceId: string): TraceSpanMeta | undefined {
    return this.traceMeta.get(traceId)
  }

  getTraceIdsByTopic(topicId: string): string[] {
    const traceIds = new Set<string>()
    for (const [traceId, meta] of this.traceMeta) {
      if (meta.topicId === topicId) traceIds.add(traceId)
    }
    for (const span of this.spans.values()) {
      if (span.topicId === topicId) traceIds.add(span.traceId)
    }
    return Array.from(traceIds)
  }

  getSpan(spanId: string): SpanEntity | undefined {
    return this.spans.get(spanId)
  }

  setSpan(span: SpanEntity): void {
    this.spans.set(span.id, span)
    if (span.traceId) {
      let ids = this.traceSpanIds.get(span.traceId)
      if (!ids) {
        ids = new Set<string>()
        this.traceSpanIds.set(span.traceId, ids)
      }
      ids.add(span.id)
      this.traceOrder.set(span.traceId, this.orderSeq++)
    }
    if (span.traceId && (span.topicId || span.modelName)) {
      this.registerTraceMeta(span.traceId, {
        topicId: span.topicId,
        modelName: span.modelName
      })
    }
    this.enforceSpanLimit()
  }

  deleteSpan(spanId: string): void {
    const span = this.spans.get(spanId)
    this.spans.delete(spanId)
    if (span) this.untrackSpan(span.traceId, spanId)
  }

  getSpans(query: TraceSpanQuery): SpanEntity[] {
    return Array.from(this.spans.values()).filter((span) => this.matchesQuery(span, query))
  }

  clear(): void {
    this.spans.clear()
    this.traceMeta.clear()
    this.traceSpanIds.clear()
    this.traceOrder.clear()
  }

  clearTrace(traceId: string, modelName?: string): void {
    for (const span of this.spans.values()) {
      if (span.traceId === traceId && this.matchesModel(span, modelName, false)) {
        this.spans.delete(span.id)
        this.untrackSpan(span.traceId, span.id)
      }
    }
    if (!modelName) {
      this.traceMeta.delete(traceId)
    }
  }

  /** Delete a specific set of spans by id (e.g. exactly the spans a flush persisted). */
  clearSpans(ids: string[]): void {
    for (const id of ids) {
      const span = this.spans.get(id)
      if (!span) continue
      this.spans.delete(id)
      this.untrackSpan(span.traceId, span.id)
    }
  }

  /**
   * Evict the oldest fully-ended trace(s) until the total span count is within the cap.
   * A trace is "fully-ended" when every span it holds has `isEnd === true`; in-flight
   * traces are skipped so streaming spans are never dropped mid-trace. If no fully-ended
   * trace exists, eviction stops and the cap is allowed to be exceeded temporarily.
   */
  private enforceSpanLimit(): void {
    while (this.spans.size > this.maxSpans) {
      const victim = this.oldestEndedTraceId()
      if (!victim) break
      this.clearTrace(victim)
      this.traceOrder.delete(victim)
    }
  }

  private oldestEndedTraceId(): string | undefined {
    let oldestTraceId: string | undefined
    let oldestOrder = Number.POSITIVE_INFINITY
    for (const [traceId, ids] of this.traceSpanIds) {
      if (ids.size === 0) continue
      let allEnded = true
      for (const spanId of ids) {
        if (!this.spans.get(spanId)?.isEnd) {
          allEnded = false
          break
        }
      }
      if (!allEnded) continue
      const order = this.traceOrder.get(traceId) ?? Number.POSITIVE_INFINITY
      if (order < oldestOrder) {
        oldestOrder = order
        oldestTraceId = traceId
      }
    }
    return oldestTraceId
  }

  private untrackSpan(traceId: string, spanId: string): void {
    const ids = this.traceSpanIds.get(traceId)
    if (!ids) return
    ids.delete(spanId)
    if (ids.size === 0) {
      this.traceSpanIds.delete(traceId)
      this.traceOrder.delete(traceId)
    }
  }

  private matchesQuery(span: SpanEntity, query: TraceSpanQuery): boolean {
    return (
      span.traceId === query.traceId &&
      (!query.topicId || span.topicId === query.topicId) &&
      this.matchesModel(span, query.modelName, true)
    )
  }

  private matchesModel(span: SpanEntity, modelName?: string, includeUnmodelled = true): boolean {
    return !modelName || span.modelName === modelName || (includeUnmodelled && !span.modelName)
  }
}
