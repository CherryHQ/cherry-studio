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

export class TraceSpanStore {
  private readonly traceMeta = new Map<string, TraceSpanMeta>()
  private readonly spans = new Map<string, SpanEntity>()

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

  hasTrace(traceId: string): boolean {
    return this.traceMeta.has(traceId) || Array.from(this.spans.values()).some((span) => span.traceId === traceId)
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
    if (span.traceId && (span.topicId || span.modelName)) {
      this.registerTraceMeta(span.traceId, {
        topicId: span.topicId,
        modelName: span.modelName
      })
    }
  }

  deleteSpan(spanId: string): void {
    this.spans.delete(spanId)
  }

  getSpans(query: TraceSpanQuery): SpanEntity[] {
    return Array.from(this.spans.values()).filter((span) => this.matchesQuery(span, query))
  }

  clear(): void {
    this.spans.clear()
    this.traceMeta.clear()
  }

  clearTrace(traceId: string, modelName?: string): void {
    for (const span of this.spans.values()) {
      if (span.traceId === traceId && this.matchesModel(span, modelName, false)) {
        this.spans.delete(span.id)
      }
    }
    if (!modelName) {
      this.traceMeta.delete(traceId)
    }
  }

  clearTopic(topicId: string, traceId?: string, modelName?: string): void {
    for (const span of this.spans.values()) {
      if (
        span.topicId === topicId &&
        (!traceId || span.traceId === traceId) &&
        this.matchesModel(span, modelName, false)
      ) {
        this.spans.delete(span.id)
      }
    }

    if (!modelName) {
      for (const [metaTraceId, meta] of this.traceMeta) {
        if (meta.topicId === topicId && (!traceId || metaTraceId === traceId)) {
          this.traceMeta.delete(metaTraceId)
        }
      }
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
