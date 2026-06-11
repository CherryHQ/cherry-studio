import fs from 'node:fs/promises'
import path from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'
import { type Activatable, BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { convertSpanToSpanEntity } from '@mcp-trace/trace-core/core/spanConvert'
import type { TraceStore } from '@mcp-trace/trace-core/core/traceStore'
import type { Attributes, AttributeValue, SpanEntity } from '@mcp-trace/trace-core/types/config'
import { SpanStatusCode } from '@opentelemetry/api'
import type { ReadableSpan, TimedEvent } from '@opentelemetry/sdk-trace-base'
import { IpcChannel } from '@shared/IpcChannel'

import { TraceSpanStore } from './TraceSpanStore'

const logger = loggerService.withContext('TraceStorageService')

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

  protected async onInit() {
    this.registerIpcHandlers()
  }

  /**
   * Activate only when developer_mode is enabled at startup.
   * Runtime preference changes take effect after restart — no runtime activate/deactivate.
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

  /**
   * Only called during app shutdown (auto-deactivation in _doStop).
   * Runtime deactivation is not supported — developer_mode changes require restart.
   */
  async onDeactivate() {
    this.store.clear()
  }

  private registerIpcHandlers() {
    this.ipcHandle(IpcChannel.TRACE_GET_DATA, (_, topicId: string, traceId: string) => this.getSpans(topicId, traceId))
    this.ipcHandle(IpcChannel.TRACE_CLEAN_LOCAL_DATA, () => this.cleanLocalData())
  }

  createSpan: (span: ReadableSpan) => void = (span: ReadableSpan) => {
    if (!this.isActivated) return
    const spanEntity = convertSpanToSpanEntity(span)
    spanEntity.isEnd = false
    this.applyTraceMeta(spanEntity)
    this.store.setSpan(spanEntity)
    this.updateModelName(spanEntity)
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
    spanEntity.events = span.events
    spanEntity.links = span.links
    spanEntity.isEnd = true
    this.updateModelName(spanEntity)
    this.store.setSpan(spanEntity)
  }

  clear: () => void = () => {
    this.store.clear()
  }

  async cleanLocalData() {
    this.store.clear()
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
  }

  saveEntity(entity: SpanEntity) {
    if (!this.isActivated) return
    this.applyTraceMeta(entity)
    if (this.store.getSpan(entity.id)) {
      this.updateEntity(entity)
    } else {
      this.addEntity(entity)
    }
    this.updateModelName(entity)
  }

  /**
   * Append a single OTel event to an in-memory span. Used by `LocalTraceWindowSink`
   * to deliver Claude Code OTLP log events that arrive separately from their parent span.
   */
  addSpanEvent(_traceId: string, spanId: string, event: TimedEvent): void {
    if (!this.isActivated) return
    const span = this.store.getSpan(spanId)
    if (!span) {
      logger.warn('addSpanEvent: span not found in store', { spanId })
      return
    }
    const events = Array.isArray(span.events) ? [...span.events, event] : [event]
    span.events = events
    this.store.setSpan(span)
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
    // A container trace flushes many turns to the SAME file across the session. Merge with what's
    // already on disk so each flush ACCUMULATES instead of overwriting earlier turns' spans.
    const existing = await this.getHistoryData(topicId, traceId)
    await this.writeTraceFile(mergeSpansById(existing, spans), topicId, traceId)
    // Clear exactly what we wrote — not the whole traceId. Spans of this trace that have no
    // topicId yet (and were therefore filtered out of the file) survive in memory to be flushed
    // once their topicId is registered, instead of being destroyed unwritten.
    this.store.clearSpans(spans.map((span) => span.id))
  }

  private async writeTraceFile(spans: SpanEntity[], topicId: string, traceId: string) {
    const dirPath = this.traceTopicDir(topicId)
    await fs.mkdir(dirPath, { recursive: true })
    const content = spans
      .filter((span) => span.topicId)
      .map((span) => JSON.stringify(span))
      .join('\n')
    const filePath = this.traceFilePath(topicId, traceId)
    // Write to a temp file then rename (atomic on the same filesystem) so a crash mid-write
    // can't truncate previously flushed history.
    const tmpPath = `${filePath}.${process.pid}.tmp`
    try {
      await fs.writeFile(tmpPath, content ? `${content}\n` : '')
      await fs.rename(tmpPath, filePath)
    } catch (error) {
      // Don't leave the partial temp file behind if write/rename fails.
      await fs.unlink(tmpPath).catch(() => {})
      throw error
    }
  }

  private async getHistoryData(topicId: string, traceId: string) {
    const filePath = this.traceFilePath(topicId, traceId)

    if (!(await this.fileExists(filePath))) {
      return []
    }

    try {
      const text = await fs.readFile(filePath, 'utf8')
      return this.parseSpanLines(text).filter((span) => span.topicId === topicId && span.traceId === traceId)
    } catch (err) {
      // Only fs.readFile reaches here (parseSpanLines tolerates per-line JSON errors itself).
      logger.error('Failed to read trace history file', err as Error, { filePath })
      throw err
    }
  }

  private parseSpanLines(text: string): SpanEntity[] {
    const spans: SpanEntity[] = []
    for (const line of text.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        spans.push(JSON.parse(trimmed) as SpanEntity)
      } catch (e) {
        logger.error(`JSON parse failed: ${trimmed}`, e as Error)
      }
    }
    return spans
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
