import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { application } from '@application'
import { BaseService } from '@main/core/lifecycle'
import { SPAN_NAME_TURN } from '@mcp-trace/trace-core/core/spanNames'
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

  // A warm Claude Code connection bakes one TRACEPARENT (the container root) across all turns, so its
  // `claude_code.*` spans land flat next to the per-turn `ai.turn` spans. getSpans re-homes each under
  // the `ai.turn` whose time window contains it (turns are sequential / non-overlapping).
  it('re-homes warm claude_code spans under the ai.turn whose time window contains them', async () => {
    await service._doInit()
    const traceId = '1234567890abcdef1234567890abcdef'
    const root = '1234567890abcdef' // deriveRootSpanId(traceId)
    service.saveEntity(
      span({ id: 'turn1', traceId, topicId: 't', name: SPAN_NAME_TURN, parentId: root, startTime: 10, endTime: 20 })
    )
    service.saveEntity(
      span({ id: 'turn2', traceId, topicId: 't', name: SPAN_NAME_TURN, parentId: root, startTime: 30, endTime: 40 })
    )
    service.saveEntity(
      span({
        id: 'cc1',
        traceId,
        topicId: 't',
        name: 'claude_code.interaction',
        parentId: root,
        startTime: 12,
        endTime: 19
      })
    )
    service.saveEntity(
      span({
        id: 'cc2',
        traceId,
        topicId: 't',
        name: 'claude_code.interaction',
        parentId: root,
        startTime: 32,
        endTime: 39
      })
    )
    service.saveEntity(
      span({
        id: 'ccx',
        traceId,
        topicId: 't',
        name: 'claude_code.interaction',
        parentId: root,
        startTime: 5,
        endTime: 6
      })
    )

    const byId = Object.fromEntries((await service.getSpans('t', traceId)).map((s) => [s.id, s]))
    expect(byId.cc1.parentId).toBe('turn1') // landed in turn 1's window
    expect(byId.cc2.parentId).toBe('turn2') // landed in turn 2's window
    expect(byId.ccx.parentId).toBe(root) // outside every turn → left under the container root
    expect(byId.turn1.parentId).toBe(root) // ai.turn spans untouched
  })
})
