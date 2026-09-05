import { createReadStream } from 'node:fs'
import fs, { type FileHandle } from 'node:fs/promises'
import path from 'node:path'
import { createInterface } from 'node:readline'

import { application } from '@application'
import { loggerService } from '@logger'
import { type Activatable, BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { SpanStatusCode } from '@opentelemetry/api'
import type { ReadableSpan, TimedEvent } from '@opentelemetry/sdk-trace-base'
import type { Attributes, AttributeValue, SpanEntity } from '@shared/data/types/trace'
import type { TraceDataCursor, TraceDataResult } from '@shared/data/types/trace'
import { IpcChannel } from '@shared/IpcChannel'

import { convertSpanToSpanEntity } from '../core/spanConvert'
import { TraceSpanStore } from './TraceSpanStore'
import type { TraceStore } from './TraceStore'

const logger = loggerService.withContext('TraceStorageService')

// Claude Code's OTLP log events (raw API bodies, tool I/O, prompts) stream in every ~1s DURING a
// turn, but the span they reference is only exported when it ENDS — so events routinely arrive
// before their span. Buffer such orphans (bounded) and drain them once the span lands, instead of
// dropping them and losing the rich per-span detail. Caps keep a span that never arrives from
// growing memory without bound; the oldest buffered span is evicted first (Map insertion order).
const MAX_PENDING_EVENT_SPANS = 1000
const MAX_PENDING_EVENTS_PER_SPAN = 200
// A single OTLP request can carry ~10 MiB of decompressed plaintext (raw request/response bodies,
// tool I/O), so the count caps above don't bound memory — one buffered span could hold megabytes.
// Cap the total retained bytes too and evict oldest-first until under budget.
const MAX_PENDING_EVENT_BYTES = 16 * 1024 * 1024

// A container trace flushes every turn of a session to the SAME file, so without retention the file
// grows without bound — and every viewer resync parses the whole of it into the main-process heap,
// the IPC payload AND the renderer's node map. Cap retained history per trace file, dropping the
// oldest spans first. Soft cap: the spans a flush is currently writing are always kept, so a file
// can exceed the budget by one flush and is trimmed back on the next.
const MAX_TRACE_FILE_BYTES = 8 * 1024 * 1024

// Byte proxy for a buffered event. `.length` counts UTF-16 units, not exact bytes, but it tracks
// event size closely enough to bound the buffer; must be deterministic so add/remove accounting stays
// balanced. ponytail: JSON.stringify estimate, swap for a byte-exact measure only if the cap proves loose.
function estimateEventBytes(event: TimedEvent): number {
  try {
    return JSON.stringify(event).length
  } catch {
    return 0
  }
}

// The MAX_PENDING_* caps above bound only the ORPHAN buffer: once a span is stored, events were
// appended to it without any limit, and Claude Code streams them for the whole turn. A measured span
// reached ~1.5k events / ~20 MiB, which is then parsed into the main heap, structure-cloned over IPC
// and retained by the renderer whole — so cap what a single stored span keeps. Held well under
// MAX_TRACE_FILE_BYTES so one span cannot consume the entire file budget on its own.
const MAX_SPAN_EVENTS = 200
const MAX_SPAN_EVENT_BYTES = 2 * 1024 * 1024

function sumEventBytes(events: TimedEvent[]): number {
  let total = 0
  for (const event of events) total += estimateEventBytes(event)
  return total
}

/**
 * Trim `events` to the retention budget, dropping oldest first. `bytes` is the caller's running
 * total for the whole array; the trimmed total is returned so an appending caller never has to
 * re-measure what it already retains. An event larger than the byte budget is dropped: trace detail
 * is best-effort and must not defeat the memory bound by itself.
 */
function capSpanEvents(events: TimedEvent[], bytes: number): { events: TimedEvent[]; bytes: number } {
  let dropped = 0
  let retained = bytes
  while (
    events.length - dropped > 0 &&
    (events.length - dropped > MAX_SPAN_EVENTS || retained > MAX_SPAN_EVENT_BYTES)
  ) {
    retained -= estimateEventBytes(events[dropped])
    dropped++
  }
  return { events: dropped > 0 ? events.slice(dropped) : events, bytes: Math.max(0, retained) }
}

function capSpanEventArray(events: TimedEvent[] | undefined): { events: TimedEvent[] | undefined; bytes: number } {
  if (!events || events.length === 0) return { events, bytes: 0 }
  const retained: TimedEvent[] = []
  let bytes = 0
  for (const event of events) {
    const eventBytes = estimateEventBytes(event)
    if (eventBytes > MAX_SPAN_EVENT_BYTES) continue
    retained.push(event)
    bytes += eventBytes
  }
  return capSpanEvents(retained, bytes)
}

/** Union spans by id; `overrides` (e.g. the live, fresher copy) wins over `base` (e.g. the history file). */
function mergeSpansById(base: SpanEntity[], overrides: SpanEntity[]): SpanEntity[] {
  const byId = new Map<string, SpanEntity>()
  for (const span of base) byId.set(span.id, span)
  for (const span of overrides) byId.set(span.id, span)
  return Array.from(byId.values())
}

@Injectable('TraceStorageService')
@ServicePhase(Phase.WhenReady)
export class TraceStorageService extends BaseService implements TraceStore, Activatable {
  private readonly store = new TraceSpanStore()
  // Orphan OTLP log events keyed by the span id they reference, awaiting that span's arrival.
  private readonly pendingEvents = new Map<string, TimedEvent[]>()
  // Running estimate of bytes retained across all pendingEvents, kept in sync on buffer/evict/drain.
  private pendingEventBytes = 0
  // Retained-event byte total per stored span. Claude Code delivers one OTLP batch as a separate
  // addSpanEvent call per event, so re-measuring the retained window on each append would be
  // quadratic in the events a span receives. Weakly keyed: an entry dies with the span it measures,
  // so store eviction and flush clearing need no bookkeeping here. A miss just re-measures once.
  private readonly spanEventBytes = new WeakMap<SpanEntity, number>()

  protected async onInit() {
    this.registerIpcHandlers()
  }

  /**
   * Establish the startup state before NodeTraceService runs. Runtime developer-mode changes are
   * coordinated by NodeTraceService so storage and the global tracer transition in a safe order.
   */
  protected async onReady() {
    const enabled = application.get('PreferenceService').get('app.developer_mode.enabled')
    logger.info(
      `Developer mode is ${enabled ? 'enabled' : 'disabled'}, trace storage ${enabled ? 'activated' : 'skipped'}`
    )
    if (enabled) {
      await this.activate()
    }
  }

  async onActivate() {
    // Keep activation cheap. Trace directories are created lazily on first file write.
  }

  /** Clear process-local trace state when tracing is disabled or the app shuts down. */
  async onDeactivate() {
    this.store.clear()
    this.clearPendingEvents()
  }

  private registerIpcHandlers() {
    this.ipcHandle(IpcChannel.TRACE_GET_DATA, (_, topicId: string, traceId: string, cursor?: TraceDataCursor) =>
      this.getTraceData(topicId, traceId, cursor)
    )
    this.ipcHandle(IpcChannel.TRACE_CLEAN_LOCAL_DATA, () => this.cleanLocalData())
  }

  createSpan: (span: ReadableSpan) => void = (span: ReadableSpan) => {
    if (!this.isActivated) return
    const spanEntity = convertSpanToSpanEntity(span)
    spanEntity.isEnd = false
    this.setRetainedEvents(spanEntity, spanEntity.events)
    this.applyTraceMeta(spanEntity)
    this.store.setSpan(spanEntity)
    this.updateModelName(spanEntity)
    this.drainPendingEvents(spanEntity.id)
  }

  endSpan: (span: ReadableSpan) => void = (span: ReadableSpan) => {
    if (!this.isActivated) return
    const spanId = span.spanContext().spanId
    const spanEntity = this.store.getSpan(spanId)
    if (!spanEntity) {
      // Missing on end means the start span was evicted or never recorded (e.g. flush race);
      // the captured end status/body would otherwise be lost silently.
      logger.warn('endSpan: span not found in store', { spanId })
      return
    }

    this.applyTraceMeta(spanEntity)
    spanEntity.endTime = span.endTime ? span.endTime[0] * 1e3 + Math.floor(span.endTime[1] / 1e6) : null
    spanEntity.status = SpanStatusCode[span.status.code]
    spanEntity.attributes = span.attributes ? ({ ...span.attributes } as Attributes) : {}
    this.setRetainedEvents(spanEntity, span.events)
    spanEntity.links = span.links
    spanEntity.isEnd = true
    this.updateModelName(spanEntity)
    this.store.setSpan(spanEntity)
  }

  clear: () => void = () => {
    this.store.clear()
    this.clearPendingEvents()
  }

  async cleanLocalData() {
    this.store.clear()
    this.clearPendingEvents()
    try {
      await fs.rm(this.traceRootDir(), { recursive: true, force: true })
    } catch (err) {
      // Surface the failure: the settings "clear data" caller must not report success while
      // plaintext trace files (which may contain captured request/response bodies) remain on disk.
      logger.error('Error cleaning local data:', err as Error)
      throw err
    }
  }

  async saveSpans(topicId: string) {
    if (!this.isActivated) return

    const traceIds = this.store.getTraceIdsByTopic(topicId)
    for (const traceId of traceIds) {
      await this.flushTrace(topicId, traceId)
    }
  }

  setTopicId(traceId: string, topicId: string): void {
    if (!this.isActivated) return
    this.store.registerTraceMeta(traceId, { topicId })
    // Backfill spans stored before this trace's topic was known — e.g. spans a prewarmed warm query
    // exported before the live connection reached prepareTrace(). Without this they keep an undefined
    // topicId and stay invisible to getSpans()/flushTrace(), which both filter on topicId === query.
    for (const span of this.store.getSpans({ traceId })) {
      if (span.topicId) continue
      span.topicId = topicId
      this.applyTraceMeta(span)
      this.store.setSpan(span)
    }
  }

  saveEntity(entity: SpanEntity) {
    if (!this.isActivated) return
    this.applyTraceMeta(entity)
    const existing = this.store.getSpan(entity.id)
    if (existing) {
      // Preserve events already on the span (incl. orphan log events drained earlier): a later
      // /v1/traces export carrying empty/partial events must not drop them. Merge into the incoming
      // entity, which is the object ultimately stored (updateModelName re-sets it after updateEntity).
      this.setRetainedEvents(entity, this.mergeEvents(existing.events, entity.events))
      // updateEntity copies onto `existing`, so its cached retained-byte total is now stale.
      this.spanEventBytes.delete(existing)
      this.updateEntity(entity)
    } else {
      this.setRetainedEvents(entity, entity.events)
      this.addEntity(entity)
    }
    this.updateModelName(entity)
    // Claude Code spans land here via /v1/traces; attach any log events that arrived first.
    this.drainPendingEvents(entity.id)
  }

  /**
   * Append a single OTel event to an in-memory span. Used by `LocalTraceWindowSink`
   * to deliver Claude Code OTLP log events that arrive separately from their parent span.
   *
   * The event's span may not be stored yet (it arrives mid-turn; the span is exported on end), so a
   * miss buffers the event for later draining (see {@link drainPendingEvents}) instead of dropping it.
   */
  addSpanEvent(_traceId: string, spanId: string, event: TimedEvent): void {
    if (!this.isActivated) return
    const span = this.store.getSpan(spanId)
    if (!span) {
      this.bufferPendingEvent(spanId, event)
      return
    }
    this.appendEventsToSpan(span, [event])
  }

  private appendEventsToSpan(span: SpanEntity, events: TimedEvent[]): void {
    if (events.length === 0) return
    const incoming = capSpanEventArray(events)
    if (!incoming.events || incoming.events.length === 0) return
    const existing = Array.isArray(span.events) ? span.events : []
    const before = this.spanEventBytes.get(span) ?? sumEventBytes(existing)
    const trimmed = capSpanEvents([...existing, ...incoming.events], before + incoming.bytes)
    span.events = trimmed.events
    this.spanEventBytes.set(span, trimmed.bytes)
    // The span object is already stored and was mutated in place, so report the size delta rather
    // than re-inserting it — setSpan would re-measure the whole span on every log event.
    this.store.touchSpan(span.id, trimmed.bytes - before)
  }

  private setRetainedEvents(span: SpanEntity, events: TimedEvent[] | undefined): void {
    const retained = capSpanEventArray(events)
    span.events = retained.events
    this.spanEventBytes.set(span, retained.bytes)
  }

  private bufferPendingEvent(spanId: string, event: TimedEvent): void {
    let events = this.pendingEvents.get(spanId)
    if (!events) {
      // Evict the oldest buffered span (insertion order) once over the span-count cap.
      if (this.pendingEvents.size >= MAX_PENDING_EVENT_SPANS) this.evictOldestPendingSpan()
      events = []
      this.pendingEvents.set(spanId, events)
    }
    if (events.length >= MAX_PENDING_EVENTS_PER_SPAN) return
    events.push(event)
    this.pendingEventBytes += estimateEventBytes(event)
    // Evict oldest buffered spans until retained plaintext fits the byte budget. A single oversized
    // orphan is dropped too: it may never receive a parent span and cannot be allowed to pin memory.
    while (this.pendingEventBytes > MAX_PENDING_EVENT_BYTES && this.pendingEvents.size > 0) {
      this.evictOldestPendingSpan()
    }
  }

  private evictOldestPendingSpan(): void {
    const oldest = this.pendingEvents.keys().next().value
    if (oldest !== undefined) this.removePendingSpan(oldest)
  }

  /** Remove a span's buffered events, keeping pendingEventBytes balanced. Returns the removed events. */
  private removePendingSpan(spanId: string): TimedEvent[] | undefined {
    const events = this.pendingEvents.get(spanId)
    if (!events) return undefined
    this.pendingEvents.delete(spanId)
    for (const event of events) this.pendingEventBytes -= estimateEventBytes(event)
    if (this.pendingEventBytes < 0) this.pendingEventBytes = 0
    return events
  }

  private clearPendingEvents(): void {
    this.pendingEvents.clear()
    this.pendingEventBytes = 0
  }

  /** Drain buffered orphan events onto a span that has just been stored. No-op when none buffered. */
  private drainPendingEvents(spanId: string): void {
    const events = this.removePendingSpan(spanId)
    if (!events) return
    const span = this.store.getSpan(spanId)
    if (!span) return
    this.appendEventsToSpan(span, events)
  }

  /**
   * Spans for a trace, MERGING the flushed history file with the live in-memory store. A container
   * trace spans many turns: earlier turns are flushed to the file and cleared from memory, while the
   * in-flight turn lives in memory. Returning only one would show just the turn in flight; the viewer
   * needs the whole tree, so union both (live wins on shared ids).
   */
  async getSpans(topicId: string, traceId: string) {
    const live = this.store.getSpans({ topicId, traceId })
    const history = await this.getHistoryData(topicId, traceId)
    // Return OTel-faithful spans merged across history + live; display-only re-parenting of warm
    // claude_code spans under their owning ai.turn is done in the renderer trace viewer.
    return mergeSpansById(history, live)
  }

  /**
   * Cursor-based viewer read. History is sent only when its file changes; otherwise the renderer
   * receives live spans changed since its last store revision. This keeps the hot poll path from
   * rereading, parsing and cloning the complete trace on every request.
   */
  async getTraceData(topicId: string, traceId: string, cursor?: TraceDataCursor): Promise<TraceDataResult> {
    const historyVersion = await this.getHistoryVersion(topicId, traceId)
    const query = { topicId, traceId }
    const liveChanges = this.store.getSpanChanges(query, cursor?.liveRevision)
    const reset = cursor === undefined || cursor.historyVersion !== historyVersion || liveChanges.reset

    if (!reset) {
      return {
        cursor: { historyVersion, liveRevision: liveChanges.revision },
        reset: false,
        spans: liveChanges.spans
      }
    }

    const history = await this.getHistoryData(topicId, traceId)
    // Take the live snapshot after the async history read so the returned revision covers every
    // in-memory mutation included in this reset response.
    const liveSnapshot = this.store.getSpanChanges(query)
    return {
      cursor: { historyVersion, liveRevision: liveSnapshot.revision },
      reset: true,
      spans: mergeSpansById(history, liveSnapshot.spans)
    }
  }

  private addEntity(entity: SpanEntity): void {
    this.applyTraceMeta(entity)
    this.store.setSpan(entity)
  }

  private applyTraceMeta(entity: SpanEntity): void {
    const meta = this.store.getTraceMeta(entity.traceId)
    const topicId = entity.topicId ?? meta?.topicId ?? this.getStringAttribute(entity, 'trace.topicId')
    const modelName =
      entity.modelName ??
      this.getStringAttribute(entity, 'trace.modelName') ??
      this.getStringAttribute(entity, 'modelName') ??
      (entity.parentId ? this.store.getSpan(entity.parentId)?.modelName : undefined) ??
      meta?.modelName

    entity.topicId = topicId
    entity.modelName = modelName

    if (entity.traceId && (topicId || modelName)) {
      this.store.registerTraceMeta(entity.traceId, { topicId, modelName })
    }
  }

  private getStringAttribute(entity: SpanEntity, key: string): string | undefined {
    const value = entity.attributes?.[key]
    return value === undefined || value === null ? undefined : value.toString()
  }

  private updateModelName(entity: SpanEntity) {
    let modelName = entity.modelName || entity.attributes?.modelName?.toString()
    if (!modelName && entity.parentId) {
      modelName = this.store.getSpan(entity.parentId)?.modelName
    }
    entity.modelName = modelName
    this.applyTraceMeta(entity)
    this.store.setSpan(entity)
  }

  private updateEntity(entity: SpanEntity): void {
    this.applyTraceMeta(entity)
    const savedEntity = this.store.getSpan(entity.id)
    if (!savedEntity) return

    const incoming = entity as unknown as Record<string, unknown>
    const target = savedEntity as unknown as Record<string, unknown>

    Object.keys(incoming).forEach((key) => {
      const value = incoming[key]
      if (value === undefined) {
        target[key] = value
        return
      }
      if (key === 'attributes') {
        this.mergeAttributes(savedEntity, value)
      } else {
        target[key] = value
      }
    })
    this.applyTraceMeta(savedEntity)
    this.store.setSpan(savedEntity)
  }

  /**
   * Union span events by name+time, preserving existing (incl. log-derived) events. The caller sends
   * the result through the same retention path used by new and ended spans, so no storage entry point
   * can bypass the per-span cap.
   */
  private mergeEvents(saved: TimedEvent[] | undefined, incoming: TimedEvent[] | undefined): TimedEvent[] | undefined {
    if (!incoming || incoming.length === 0) return saved
    if (!saved || saved.length === 0) return incoming
    const eventKey = (event: TimedEvent) =>
      `${event.name}@${Array.isArray(event.time) ? `${event.time[0]}.${event.time[1]}` : String(event.time)}`
    const seen = new Set<string>()
    const merged: TimedEvent[] = []
    for (const event of [...saved, ...incoming]) {
      const key = eventKey(event)
      if (seen.has(key)) continue
      seen.add(key)
      merged.push(event)
    }
    return merged
  }

  private mergeAttributes(savedEntity: SpanEntity, value: unknown): void {
    const savedAttrs = savedEntity.attributes || {}
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      savedEntity.attributes = value as Attributes
      return
    }

    Object.keys(value).forEach((attrKey) => {
      const rawValue = (value as Record<string, AttributeValue>)[attrKey]
      // A `{`-prefixed string is not guaranteed to be valid JSON; an unguarded parse would
      // throw and silently drop the whole span. Fall back to the raw value on parse failure.
      let jsonData: unknown = rawValue
      if (typeof rawValue === 'string' && rawValue.startsWith('{')) {
        try {
          jsonData = JSON.parse(rawValue)
        } catch {
          jsonData = rawValue
        }
      }
      if (
        savedAttrs[attrKey] !== undefined &&
        typeof jsonData === 'object' &&
        jsonData !== null &&
        typeof savedAttrs[attrKey] === 'object' &&
        savedAttrs[attrKey] !== null
      ) {
        savedAttrs[attrKey] = { ...savedAttrs[attrKey], ...jsonData } as AttributeValue
      } else {
        savedAttrs[attrKey] = rawValue
      }
    })
    savedEntity.attributes = savedAttrs
  }

  private async flushTrace(topicId: string, traceId: string) {
    const spans = this.store.getSpans({ topicId, traceId })
    if (spans.length === 0) return
    await this.writeTraceFile(spans, topicId, traceId)
    // Clear exactly what we wrote — not the whole traceId. Spans of this trace that have no
    // topicId yet (and were therefore filtered out of the file) survive in memory to be flushed
    // once their topicId is registered, instead of being destroyed unwritten.
    this.store.clearSpans(spans.map((span) => span.id))
  }

  private async writeTraceFile(spans: SpanEntity[], topicId: string, traceId: string) {
    const dirPath = this.traceTopicDir(topicId)
    // Owner-only perms: trace JSONL holds raw prompts/API bodies (dev-gated
    // plaintext by design) and userData can be world-readable on Linux (0755).
    await fs.mkdir(dirPath, { recursive: true, mode: 0o700 })
    const filePath = this.traceFilePath(topicId, traceId)
    const replacements = new Map(
      spans
        .filter((span) => span.topicId === topicId && span.traceId === traceId)
        .map((span) => [span.id, span] as const)
    )
    const historySize = await this.historyFileSize(filePath)
    // Only measure for trimming when the file is already over budget — the common case pays nothing.
    const dropped =
      historySize !== null && historySize > MAX_TRACE_FILE_BYTES
        ? await this.countExpiredHistorySpans(filePath, topicId, traceId)
        : 0
    if (dropped > 0) {
      logger.info('Trimming trace history to the retention budget', { topicId, traceId, dropped })
    }
    // Write to a temp file then rename (atomic on the same filesystem) so a crash mid-write
    // can't truncate previously flushed history. Stream the prior file one line at a time instead
    // of parsing and serializing the complete trace into several large in-memory copies.
    const tmpPath = `${filePath}.${process.pid}.tmp`
    let output: FileHandle | undefined
    try {
      output = await fs.open(tmpPath, 'w', 0o600)
      if (historySize !== null) {
        const handle = output
        const seenIds = new Set<string>()
        await this.forEachSpanLine(filePath, async (existing, line) => {
          if (existing.topicId !== topicId || existing.traceId !== traceId || seenIds.has(existing.id)) return
          seenIds.add(existing.id)
          const replacement = replacements.get(existing.id)
          // A span this flush re-writes is current data, so retention never trims it.
          if (seenIds.size <= dropped && !replacement) return
          await this.writeSpanLine(handle, replacement ?? line)
          replacements.delete(existing.id)
        })
      }
      for (const span of replacements.values()) {
        await this.writeSpanLine(output, span)
      }
      await output.close()
      output = undefined
      await fs.rename(tmpPath, filePath)
    } catch (error) {
      // Don't leave the partial temp file behind if write/rename fails.
      await output?.close().catch(() => {})
      await fs.unlink(tmpPath).catch(() => {})
      throw error
    }
  }

  private async writeSpanLine(output: FileHandle, span: SpanEntity | string): Promise<void> {
    const content = Buffer.from(`${typeof span === 'string' ? span : JSON.stringify(span)}\n`)
    let offset = 0
    while (offset < content.length) {
      const { bytesWritten } = await output.write(content, offset, content.length - offset, null)
      if (bytesWritten === 0) throw new Error('TraceStorageService: failed to make progress writing trace file')
      offset += bytesWritten
    }
  }

  /**
   * How many of the oldest history spans must be dropped for the rewritten file to fit
   * {@link MAX_TRACE_FILE_BYTES}. Sizes are measured from the file on disk in a streaming pass, so
   * sizing never needs the trace in memory; spans this flush replaces or appends are accounted for
   * on the next flush instead.
   */
  private async countExpiredHistorySpans(filePath: string, topicId: string, traceId: string): Promise<number> {
    const sizes: number[] = []
    const seenIds = new Set<string>()
    await this.forEachSpanLine(filePath, (span, line) => {
      if (span.topicId !== topicId || span.traceId !== traceId || seenIds.has(span.id)) return
      seenIds.add(span.id)
      sizes.push(Buffer.byteLength(line) + 1)
    })

    let retained = 0
    let dropped = sizes.length
    for (let index = sizes.length - 1; index >= 0; index--) {
      if (retained + sizes[index] > MAX_TRACE_FILE_BYTES) break
      retained += sizes[index]
      dropped = index
    }
    return dropped
  }

  private async getHistoryData(topicId: string, traceId: string) {
    const filePath = this.traceFilePath(topicId, traceId)

    if (!(await this.fileExists(filePath))) {
      return []
    }

    const spans: SpanEntity[] = []
    try {
      await this.forEachSpanLine(filePath, (span) => {
        if (span.topicId === topicId && span.traceId === traceId) spans.push(span)
      })
    } catch (err) {
      // Only the stream read reaches here (forEachSpanLine tolerates per-line JSON errors itself).
      logger.error('Failed to read trace history file', err as Error, { filePath })
      throw err
    }
    return spans
  }

  /**
   * Stream a trace file one span per line. Both the viewer read and the flush rewrite go through
   * this, so neither ever holds the complete trace as one large text blob alongside its parsed copy.
   * `line` is the trimmed source text, letting callers reuse it without re-serializing the span.
   */
  private async forEachSpanLine(
    filePath: string,
    visit: (span: SpanEntity, line: string) => void | Promise<void>
  ): Promise<void> {
    const input = createReadStream(filePath, { encoding: 'utf8' })
    const lines = createInterface({ input, crlfDelay: Infinity })
    try {
      for await (const line of lines) {
        const span = this.parseSpanLine(line)
        if (span) await visit(span, line.trim())
      }
    } finally {
      lines.close()
      input.destroy()
    }
  }

  private parseSpanLine(line: string): SpanEntity | undefined {
    const trimmed = line.trim()
    if (!trimmed) return undefined
    try {
      return JSON.parse(trimmed) as SpanEntity
    } catch (error) {
      logger.error('Failed to parse trace history line', error as Error, { lineLength: trimmed.length })
      return undefined
    }
  }

  private async getHistoryVersion(topicId: string, traceId: string): Promise<string | null> {
    const filePath = this.traceFilePath(topicId, traceId)
    try {
      const stats = await fs.stat(filePath, { bigint: true })
      return `${stats.mtimeNs}:${stats.size}`
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return null
      throw error
    }
  }

  private traceRootDir(): string {
    return application.getPath('feature.trace')
  }

  /**
   * `topicId`/`traceId` arrive from renderer IPC and are joined into `fs.rm`/`readFile` paths.
   * Reject anything that isn't a single safe path segment so a value like `../../../etc` can't
   * escape the trace root into an arbitrary-delete/read primitive (reachable via an XSS pivot).
   */
  private assertSafeSegment(value: string, label: string): void {
    if (
      !value ||
      value === '.' ||
      value === '..' ||
      value.includes('/') ||
      value.includes('\\') ||
      path.isAbsolute(value)
    ) {
      throw new Error(`TraceStorageService: invalid ${label} path segment`)
    }
  }

  private traceTopicDir(topicId: string): string {
    this.assertSafeSegment(topicId, 'topicId')
    return path.join(this.traceRootDir(), topicId)
  }

  private traceFilePath(topicId: string, traceId: string): string {
    this.assertSafeSegment(traceId, 'traceId')
    return path.join(this.traceTopicDir(topicId), traceId)
  }

  /** Size in bytes of an existing trace file, or null when it has not been written yet. */
  private async historyFileSize(filePath: string): Promise<number | null> {
    try {
      return (await fs.stat(filePath)).size
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return null
      throw err
    }
  }

  private async fileExists(filePath: string) {
    try {
      await fs.access(filePath)
      return true
    } catch (err) {
      // Only a genuinely-missing file means "no history". Surface anything else (e.g. EACCES)
      // instead of silently returning an empty viewer.
      if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return false
      throw err
    }
  }
}
