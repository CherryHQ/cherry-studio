import type { SpanEntity } from '@shared/data/types/trace'

export interface TraceSpanMeta {
  topicId?: string
  modelName?: string
}

export interface TraceSpanQuery {
  topicId?: string
  traceId: string
  modelName?: string
}

export interface TraceSpanChanges {
  revision: number
  reset: boolean
  spans: SpanEntity[]
}

// Diagnostic retention is bounded even while a root span remains active.
const DEFAULT_MAX_SPANS = 50_000
const DEFAULT_MAX_SPAN_BYTES = 64 * 1024 * 1024

// Conservative serialized-size estimate without allocating another copy of captured bodies.
function estimateSpanBytes(value: unknown, seen = new Set<object>()): number {
  if (typeof value === 'string') return value.length * 6 + 2
  if (value === null || typeof value !== 'object') return 16
  if (seen.has(value)) return 0
  seen.add(value)
  let bytes = 32
  for (const [key, child] of Object.entries(value)) {
    bytes += key.length * 6 + 4 + estimateSpanBytes(child, seen)
  }
  return bytes
}

/**
 * Cap on retained per-trace deletion markers. A marker only matters until every viewer cursor has
 * advanced past it, but the store cannot know when that happened, so markers would otherwise
 * accumulate one entry per trace id ever flushed — unbounded over a long session. Evicting the
 * oldest into {@link TraceSpanStore.evictedResetRevision} preserves correctness: a cursor older
 * than anything dropped is forced to resync rather than silently missing a deletion.
 */
const MAX_TRACKED_RESETS = 1_000

export class TraceSpanStore {
  private readonly traceMeta = new Map<string, TraceSpanMeta>()
  private readonly spans = new Map<string, SpanEntity>()
  // Per-trace span-id index, used for O(span-count) eviction without scanning all spans.
  private readonly traceSpanIds = new Map<string, Set<string>>()
  // Per-trace recency counter; lower values are older. Bumped on every setSpan.
  private readonly traceOrder = new Map<string, number>()
  private readonly spanRevisions = new Map<string, number>()
  // Insertion order is kept in revision order (oldest first) by markTraceReset, so eviction can
  // drop the oldest marker without scanning.
  private readonly traceResetRevisions = new Map<string, number>()
  // Per-span retained byte estimate, and its running sum. Kept in step on every insert/remove so
  // eviction can consult a byte budget without re-measuring the store.
  private readonly spanBytes = new Map<string, number>()
  private totalBytes = 0
  private globalResetRevision = 0
  private evictedResetRevision = 0
  private orderSeq = 0
  private revisionSeq = 0

  constructor(
    private readonly maxSpans = DEFAULT_MAX_SPANS,
    private readonly maxSpanBytes = DEFAULT_MAX_SPAN_BYTES
  ) {}

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
    const revision = this.nextRevision()
    this.spans.set(span.id, span)
    this.spanRevisions.set(span.id, revision)
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
    this.trackBytes(span.id, estimateSpanBytes(span))
    this.enforceSpanLimit()
  }

  /**
   * Record that an already-stored span mutated in place, shifting its retained size by `deltaBytes`.
   * Claude Code delivers one OTLP batch as a separate call per log event, so the appending caller
   * reports the delta it already computed rather than making the store re-measure the whole span on
   * every event — which would be quadratic in the events a span receives.
   */
  touchSpan(spanId: string, deltaBytes: number): void {
    const span = this.spans.get(spanId)
    if (!span) return
    this.spanRevisions.set(spanId, this.nextRevision())
    if (span.traceId) this.traceOrder.set(span.traceId, this.orderSeq++)
    this.trackBytes(spanId, (this.spanBytes.get(spanId) ?? 0) + deltaBytes * 6)
    this.enforceSpanLimit()
  }

  deleteSpan(spanId: string): void {
    const span = this.spans.get(spanId)
    if (!span) return
    const revision = this.nextRevision()
    this.spans.delete(spanId)
    this.spanRevisions.delete(spanId)
    this.untrackBytes(spanId)
    this.markTraceReset(span.traceId, revision)
    this.untrackSpan(span.traceId, spanId)
  }

  getSpans(query: TraceSpanQuery): SpanEntity[] {
    const spans: SpanEntity[] = []
    for (const spanId of this.traceSpanIds.get(query.traceId) ?? []) {
      const span = this.spans.get(spanId)
      if (span && this.matchesQuery(span, query)) spans.push(span)
    }
    return spans
  }

  getSpanChanges(query: TraceSpanQuery, afterRevision?: number): TraceSpanChanges {
    const revision = this.revisionSeq
    const resetRevision = Math.max(
      this.globalResetRevision,
      this.evictedResetRevision,
      this.traceResetRevisions.get(query.traceId) ?? 0
    )
    const reset = afterRevision === undefined || afterRevision > revision || afterRevision < resetRevision
    const spans = this.getSpans(query).filter(
      (span) => reset || (this.spanRevisions.get(span.id) ?? 0) > (afterRevision ?? 0)
    )
    return { revision, reset, spans }
  }

  clear(): void {
    if (
      this.spans.size > 0 ||
      this.traceMeta.size > 0 ||
      this.traceResetRevisions.size > 0 ||
      this.evictedResetRevision > 0
    ) {
      this.globalResetRevision = this.nextRevision()
    }
    this.spans.clear()
    this.traceMeta.clear()
    this.traceSpanIds.clear()
    this.traceOrder.clear()
    this.spanRevisions.clear()
    this.traceResetRevisions.clear()
    this.spanBytes.clear()
    this.totalBytes = 0
    // globalResetRevision already dominates every marker just dropped.
    this.evictedResetRevision = 0
  }

  clearTrace(traceId: string, modelName?: string): void {
    const removedIds: string[] = []
    for (const span of this.spans.values()) {
      if (span.traceId === traceId && this.matchesModel(span, modelName, false)) {
        removedIds.push(span.id)
      }
    }
    this.removeSpans(removedIds)
    if (!modelName) {
      this.traceMeta.delete(traceId)
    }
  }

  /** Delete a specific set of spans by id (e.g. exactly the spans a flush persisted). */
  clearSpans(ids: string[]): void {
    this.removeSpans(ids)
  }

  private removeSpans(ids: string[]): void {
    const resetRevision = ids.some((id) => this.spans.has(id)) ? this.nextRevision() : undefined
    for (const id of ids) {
      const span = this.spans.get(id)
      if (!span) continue
      this.spans.delete(id)
      this.spanRevisions.delete(id)
      this.untrackBytes(id)
      if (resetRevision !== undefined) this.markTraceReset(span.traceId, resetRevision)
      this.untrackSpan(span.traceId, span.id)
    }
  }

  private trackBytes(spanId: string, bytes: number): void {
    const next = Math.max(0, bytes)
    this.totalBytes += next - (this.spanBytes.get(spanId) ?? 0)
    this.spanBytes.set(spanId, next)
  }

  private untrackBytes(spanId: string): void {
    const bytes = this.spanBytes.get(spanId)
    if (bytes === undefined) return
    this.spanBytes.delete(spanId)
    this.totalBytes = Math.max(0, this.totalBytes - bytes)
  }

  /**
   * Record that `traceId` lost spans at `revision`, so cursors older than that must resync.
   * Re-inserting keeps the map in revision order; the oldest marker is evicted past
   * {@link MAX_TRACKED_RESETS} and folded into the conservative global floor.
   */
  private markTraceReset(traceId: string, revision: number): void {
    this.traceResetRevisions.delete(traceId)
    this.traceResetRevisions.set(traceId, revision)
    while (this.traceResetRevisions.size > MAX_TRACKED_RESETS) {
      const oldest = this.traceResetRevisions.entries().next().value
      if (!oldest) break
      this.traceResetRevisions.delete(oldest[0])
      this.evictedResetRevision = Math.max(this.evictedResetRevision, oldest[1])
    }
  }

  private enforceSpanLimit(): void {
    while (this.spans.size > this.maxSpans || this.totalBytes > this.maxSpanBytes) {
      const victim = this.oldestEndedTraceId()
      if (victim) {
        this.clearTrace(victim)
        continue
      }
      const ended = [...this.spans.values()].find((span) => span.isEnd)
      const oldest = ended ?? this.spans.values().next().value
      if (!oldest) break
      this.deleteSpan(oldest.id)
      const root = [...this.spans.values()].find((span) => span.traceId === oldest.traceId && !span.isEnd)
      if (root) {
        root.attributes = {
          ...root.attributes,
          'cs.trace.dropped_spans': Number(root.attributes?.['cs.trace.dropped_spans'] ?? 0) + 1
        }
        this.spanRevisions.set(root.id, this.nextRevision())
        this.trackBytes(root.id, estimateSpanBytes(root))
      }
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

  private nextRevision(): number {
    this.revisionSeq += 1
    return this.revisionSeq
  }
}
