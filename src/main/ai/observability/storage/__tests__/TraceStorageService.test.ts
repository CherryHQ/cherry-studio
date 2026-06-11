import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { application } from '@application'
import { BaseService } from '@main/core/lifecycle'
import { convertSpanToSpanEntity } from '@mcp-trace/trace-core/core/spanConvert'
import type { SpanEntity } from '@mcp-trace/trace-core/types/config'
import { SpanStatusCode } from '@opentelemetry/api'
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base'
import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { mockMainLoggerService } from '@test-mocks/MainLoggerService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TraceSpanStore } from '../TraceSpanStore'
import { TraceStorageService } from '../TraceStorageService'

function span(overrides: Partial<SpanEntity>): SpanEntity {
  return {
    id: 'span',
    name: 'span',
    parentId: '',
    traceId: 'trace',
    status: 'OK',
    kind: 'internal',
    attributes: undefined,
    isEnd: true,
    events: undefined,
    startTime: 1,
    endTime: 2,
    links: undefined,
    ...overrides
  }
}

// Minimal ReadableSpan shaped for the fields convertSpanToSpanEntity / createSpan / endSpan read.
function readableSpan(overrides: { spanId: string; traceId: string; ended: boolean }): ReadableSpan {
  return {
    name: 'otel-span',
    kind: 0,
    spanContext: () => ({ spanId: overrides.spanId, traceId: overrides.traceId, traceFlags: 1 }),
    parentSpanContext: undefined,
    startTime: [1, 0],
    endTime: overrides.ended ? [2, 0] : [0, 0],
    ended: overrides.ended,
    status: { code: SpanStatusCode.OK },
    attributes: {},
    events: [],
    links: []
  } as unknown as ReadableSpan
}

describe('TraceStorageService', () => {
  let service: TraceStorageService
  let traceDir: string

  beforeEach(async () => {
    BaseService.resetInstances()
    MockMainPreferenceServiceUtils.resetMocks()
    MockMainPreferenceServiceUtils.setPreferenceValue('app.developer_mode.enabled', true)
    traceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'span-cache-service-'))
    vi.mocked(application.getPath).mockReset()
    vi.mocked(application.getPath).mockReturnValue(traceDir)
    mockMainLoggerService.error.mockClear()
    service = new TraceStorageService()
  })

  afterEach(async () => {
    await fs.rm(traceDir, { recursive: true, force: true })
  })

  it('activates without touching the trace path', async () => {
    await service._doInit()

    expect(service.isActivated).toBe(true)
    expect(application.getPath).not.toHaveBeenCalled()
  })

  it('rejects a path-traversal topicId in getSpans instead of escaping the trace root (REGRESSION observability-1)', async () => {
    await service._doInit()
    // A sentinel sibling of the trace root that a `../` traversal would target for deletion.
    const sentinelDir = await fs.mkdtemp(path.join(os.tmpdir(), 'span-cache-sentinel-'))
    const sentinelFile = path.join(sentinelDir, 'keep.txt')
    await fs.writeFile(sentinelFile, 'do not delete')

    const traversal = `..${path.sep}${path.basename(sentinelDir)}`
    await expect(service.getSpans(traversal, 'trace-a')).rejects.toThrow(/invalid topicId/)
    // The traversal target survives — no arbitrary delete happened.
    await expect(fs.access(sentinelFile)).resolves.toBeUndefined()

    await fs.rm(sentinelDir, { recursive: true, force: true })
  })

  it.each([
    ['empty', ''],
    ['dot', '.'],
    ['dot-dot', '..'],
    ['forward slash', 'a/b'],
    ['back slash', 'a\\b'],
    ['absolute', '/abs']
  ])('rejects an unsafe traceId segment (%s) on the read path', async (_label, badTraceId) => {
    await service._doInit()
    await expect(service.getSpans('topic-a', badTraceId)).rejects.toThrow(/invalid traceId/)
  })

  it('returns a merged view of flushed history and live spans for a trace', async () => {
    await service._doInit()

    service.saveEntity(span({ id: 'history', name: 'from-history', traceId: 'trace-a', topicId: 'topic-a' }))
    await service.saveSpans('topic-a')

    service.saveEntity(span({ id: 'live', name: 'from-live', traceId: 'trace-a', topicId: 'topic-a' }))
    service.saveEntity(span({ id: 'history', name: 'live-wins', traceId: 'trace-a', topicId: 'topic-a' }))

    await expect(service.getSpans('topic-a', 'trace-a')).resolves.toMatchObject([
      { id: 'history', name: 'live-wins' },
      { id: 'live', name: 'from-live' }
    ])
  })

  // The OTel createSpan/endSpan path is the live source of cached spans. If endSpan does not
  // mark the entity ended, TraceSpanStore can never evict the trace and memory grows unbounded
  // while developer_mode is on. Drive a span through the real pipeline and confirm a fully-ended
  // trace IS evicted under a small cap. (Pre-fix: isEnd stays undefined → no eviction → fails.)
  it('marks createSpan/endSpan entities so a fully-ended trace becomes evictable (REGRESSION observability-eviction)', async () => {
    await service._doInit()

    // 1. In-flight span from createSpan must not be ended.
    service.createSpan(readableSpan({ spanId: 'live', traceId: 'trace-live', ended: false }))
    expect(service['store'].getSpan('live')?.isEnd).toBe(false)

    // 2. endSpan must mark the entity ended.
    service.endSpan(readableSpan({ spanId: 'live', traceId: 'trace-live', ended: true }))
    expect(service['store'].getSpan('live')?.isEnd).toBe(true)

    // 3. Feed the real pipeline-produced entity into a small-cap store and confirm the
    //    fully-ended trace is evicted when the cap is exceeded. This is the end-to-end
    //    assertion that fails pre-fix (isEnd undefined → oldestEndedTraceId() skips it).
    const endedEntity = service['store'].getSpan('live') as SpanEntity
    const cappedStore = new TraceSpanStore(1)
    cappedStore.setSpan({ ...endedEntity })
    cappedStore.setSpan(span({ id: 'newer', traceId: 'trace-newer' }))

    expect(cappedStore.getSpan('live')).toBeUndefined()
    expect(cappedStore.getSpan('newer')).toBeDefined()
  })

  // The AiTurnTrace end-patch builds entities with `convertSpanToSpanEntity` and writes them via
  // `writeSpanEntity` → `saveEntity` (no explicit isEnd override like createSpan/endSpan have).
  // Pre-fix the converter omitted `isEnd` (the `as SpanEntity` cast hid the missing field), so turn
  // root spans landed with `isEnd: undefined` and their traces were never evictable. Confirm the
  // converter now derives `isEnd` from `span.ended` and the saved entity is evictable.
  it('derives isEnd through the saveEntity/convertSpanToSpanEntity path (REGRESSION observability-eviction-saveEntity)', async () => {
    await service._doInit()

    // Converter sets isEnd from the OTel `ended` flag — true for an ended span, false in-flight.
    const endedEntity = convertSpanToSpanEntity(readableSpan({ spanId: 'turn-root', traceId: 'trace-x', ended: true }))
    expect(endedEntity.isEnd).toBe(true)
    expect(convertSpanToSpanEntity(readableSpan({ spanId: 'live2', traceId: 'trace-y', ended: false })).isEnd).toBe(
      false
    )

    // The saveEntity path keeps isEnd (addEntity never sets it), so the trace is evictable.
    service.saveEntity({ ...endedEntity, topicId: 't' } as SpanEntity)
    expect(service['store'].getSpan('turn-root')?.isEnd).toBe(true)

    const cappedStore = new TraceSpanStore(1)
    cappedStore.setSpan({ ...(service['store'].getSpan('turn-root') as SpanEntity) })
    cappedStore.setSpan(span({ id: 'newer', traceId: 'trace-newer' }))
    expect(cappedStore.getSpan('turn-root')).toBeUndefined()
    expect(cappedStore.getSpan('newer')).toBeDefined()
  })

  // Container traces span many turns under ONE trace id, all flushing to the same file. Pre-fix,
  // each flush overwrote the file + cleared memory and getSpans returned live-or-else-history, so the
  // viewer only ever saw the turn in flight. Confirm the whole trace accumulates instead.
  it('accumulates spans across turns sharing one container trace id (REGRESSION trace-container-merge)', async () => {
    await service._doInit()

    // Turn 1: a span flushed to the history file and cleared from memory.
    service.saveEntity(span({ id: 's1', traceId: 'trace', topicId: 'topic', name: 'turn-1' }))
    await service.saveSpans('topic')

    // Turn 2: a fresh span in memory while turn 1 lives only on disk.
    service.saveEntity(span({ id: 's2', traceId: 'trace', topicId: 'topic', name: 'turn-2' }))

    // getSpans merges live (turn 2) + history (turn 1) — the whole trace, not just the turn in flight.
    const live = await service.getSpans('topic', 'trace')
    expect(live.map((s) => s.id).sort()).toEqual(['s1', 's2'])

    // Flushing turn 2 ACCUMULATES onto the file instead of overwriting turn 1.
    await service.saveSpans('topic')
    const flushed = await service.getSpans('topic', 'trace')
    expect(flushed.map((s) => s.id).sort()).toEqual(['s1', 's2'])
  })
})
