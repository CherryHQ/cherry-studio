import fs from 'node:fs/promises'
import path from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'
import { type Activatable, BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { convertSpanToSpanEntity } from '@mcp-trace/trace-core/core/spanConvert'
import type { TraceCache } from '@mcp-trace/trace-core/core/traceCache'
import type { Attributes, AttributeValue, SpanEntity } from '@mcp-trace/trace-core/types/config'
import { SpanStatusCode } from '@opentelemetry/api'
import type { ReadableSpan, TimedEvent } from '@opentelemetry/sdk-trace-base'
import { IpcChannel } from '@shared/IpcChannel'

import { TraceSpanStore } from './TraceSpanStore'

const logger = loggerService.withContext('SpanCacheService')

@Injectable('SpanCacheService')
@ServicePhase(Phase.WhenReady)
export class SpanCacheService extends BaseService implements TraceCache, Activatable {
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
      `Developer mode is ${enabled ? 'enabled' : 'disabled'}, span caching ${enabled ? 'activated' : 'skipped'}`
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
    this.ipcHandle(IpcChannel.TRACE_SAVE_DATA, (_, topicId: string) => this.saveSpans(topicId))
    this.ipcHandle(IpcChannel.TRACE_SAVE_ENTITY, (_, entity: SpanEntity) => this.saveEntity(entity))
    this.ipcHandle(IpcChannel.TRACE_GET_ENTITY, (_, spanId: string) => this.getEntity(spanId))
    this.ipcHandle(IpcChannel.TRACE_BIND_TOPIC, (_, topicId: string, traceId: string) =>
      this.setTopicId(traceId, topicId)
    )
    this.ipcHandle(IpcChannel.TRACE_CLEAN_HISTORY, (_, topicId: string, traceId: string, modelName?: string) =>
      this.cleanHistoryTrace(topicId, traceId, modelName)
    )
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
      logger.error('Error cleaning local data:', err as Error)
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

  getEntity(spanId: string): SpanEntity | undefined {
    return this.store.getSpan(spanId)
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
    if (!span) return
    const events = Array.isArray(span.events) ? [...span.events, event] : [event]
    span.events = events
    this.store.setSpan(span)
  }

  async cleanHistoryTrace(topicId: string, traceId: string, modelName?: string) {
    this.store.clearTrace(traceId, modelName)

    const filePath = this.traceFilePath(topicId, traceId)
    if (!(await this.fileExists(filePath))) {
      return
    }

    if (!modelName) {
      await fs.rm(filePath, { force: true })
      return
    }

    const allSpans = await this.getHistoryData(topicId, traceId)
    const remainingSpans = allSpans.filter((span) => span.modelName !== modelName)
    if (remainingSpans.length === 0) {
      await fs.rm(filePath, { force: true })
      return
    }
    await this.writeTraceFile(remainingSpans, topicId, traceId)
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
    await this.writeTraceFile(spans, topicId, traceId)
    this.store.clearTrace(traceId)
  }

  private async writeTraceFile(spans: SpanEntity[], topicId: string, traceId: string) {
    const dirPath = this.traceTopicDir(topicId)
    await fs.mkdir(dirPath, { recursive: true })
    const content = spans
      .filter((span) => span.topicId)
      .map((span) => JSON.stringify(span))
      .join('\n')
    await fs.writeFile(this.traceFilePath(topicId, traceId), content ? `${content}\n` : '')
  }

  private async getHistoryData(topicId: string, traceId: string, modelName?: string) {
    const filePath = this.traceFilePath(topicId, traceId)

    if (!(await this.fileExists(filePath))) {
      return []
    }

    try {
      const text = await fs.readFile(filePath, 'utf8')
      return this.parseSpanLines(text)
        .filter((span) => span.topicId === topicId && span.traceId === traceId)
        .filter((span) => !modelName || span.modelName === modelName || !span.modelName)
    } catch (err) {
      logger.error('Error parsing JSON:', err as Error)
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
      throw new Error(`SpanCacheService: invalid ${label} path segment`)
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
    } catch {
      return false
    }
  }
}
