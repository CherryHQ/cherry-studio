import type { SpanEntity } from '@mcp-trace/trace-core/types/config'
import { describe, expect, it } from 'vitest'

import { TraceSpanStore } from '../TraceSpanStore'

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

describe('TraceSpanStore eviction', () => {
  it('returns only spans changed after a live revision and requests a reset after deletion', () => {
    const store = new TraceSpanStore()

    store.setSpan(span({ id: 'a', traceId: 'trace-a', name: 'first' }))
    const initial = store.getSpanChanges({ traceId: 'trace-a' })

    expect(initial.reset).toBe(true)
    expect(initial.spans.map((item) => item.id)).toEqual(['a'])

    store.setSpan(span({ id: 'a', traceId: 'trace-a', name: 'updated' }))
    const changed = store.getSpanChanges({ traceId: 'trace-a' }, initial.revision)

    expect(changed.reset).toBe(false)
    expect(changed.spans).toMatchObject([{ id: 'a', name: 'updated' }])

    store.clearSpans(['a'])
    const cleared = store.getSpanChanges({ traceId: 'trace-a' }, changed.revision)

    expect(cleared.reset).toBe(true)
    expect(cleared.spans).toEqual([])
  })

  // One deletion marker per trace id ever flushed would grow for the life of the process. Markers
  // must stay bounded WITHOUT letting a stale cursor silently miss the deletion a dropped marker
  // recorded — an evicted marker has to keep forcing a resync.
  it('bounds deletion markers while still forcing a resync for cursors older than an evicted marker', () => {
    const store = new TraceSpanStore()

    store.setSpan(span({ id: 'old', traceId: 'trace-old' }))
    const stale = store.getSpanChanges({ traceId: 'trace-old' })
    store.clearSpans(['old'])

    // Push trace-old's marker out of the bounded map.
    for (let i = 0; i < 1_000; i++) {
      store.setSpan(span({ id: `s${i}`, traceId: `t${i}` }))
      store.clearSpans([`s${i}`])
    }

    expect(store['traceResetRevisions'].size).toBeLessThanOrEqual(1_000)
    expect(store.getSpanChanges({ traceId: 'trace-old' }, stale.revision).reset).toBe(true)

    // The conservative floor must not force a resync on cursors newer than everything evicted.
    store.setSpan(span({ id: 'fresh', traceId: 'trace-fresh' }))
    const fresh = store.getSpanChanges({ traceId: 'trace-fresh' })
    store.setSpan(span({ id: 'fresh', traceId: 'trace-fresh', name: 'updated' }))

    expect(store.getSpanChanges({ traceId: 'trace-fresh' }, fresh.revision).reset).toBe(false)
  })

  it('evicts the oldest fully-ended trace when the span cap is exceeded', () => {
    const store = new TraceSpanStore(2)

    store.setSpan(span({ id: 'a', traceId: 'trace-a' }))
    store.setSpan(span({ id: 'b', traceId: 'trace-b' }))
    // Exceeding the cap evicts the oldest fully-ended trace (trace-a).
    store.setSpan(span({ id: 'c', traceId: 'trace-c' }))

    expect(store.getSpan('a')).toBeUndefined()
    expect(store.getSpan('b')).toBeDefined()
    expect(store.getSpan('c')).toBeDefined()
    expect(store.getSpans({ traceId: 'trace-a' })).toEqual([])
  })

  it('never evicts an in-flight trace, even if it is the oldest', () => {
    const store = new TraceSpanStore(2)

    // Oldest trace is still streaming (isEnd === false).
    store.setSpan(span({ id: 'a', traceId: 'trace-a', isEnd: false }))
    store.setSpan(span({ id: 'b', traceId: 'trace-b' }))
    store.setSpan(span({ id: 'c', traceId: 'trace-c' }))

    // trace-a is preserved; trace-b (oldest fully-ended) is evicted instead.
    expect(store.getSpan('a')).toBeDefined()
    expect(store.getSpan('b')).toBeUndefined()
    expect(store.getSpan('c')).toBeDefined()
  })

  it('keeps all spans when no fully-ended trace can be evicted', () => {
    const store = new TraceSpanStore(1)

    store.setSpan(span({ id: 'a', traceId: 'trace-a', isEnd: false }))
    store.setSpan(span({ id: 'b', traceId: 'trace-b', isEnd: false }))

    // No fully-ended trace exists, so the cap is exceeded rather than dropping live spans.
    expect(store.getSpan('a')).toBeDefined()
    expect(store.getSpan('b')).toBeDefined()
  })

  it('untracks evicted traces so later queries and meta are clean', () => {
    const store = new TraceSpanStore(1)

    store.setSpan(span({ id: 'a', traceId: 'trace-a', topicId: 'topic-a' }))
    store.setSpan(span({ id: 'b', traceId: 'trace-b', topicId: 'topic-b' }))

    expect(store.getSpan('a')).toBeUndefined()
    expect(store.getTraceMeta('trace-a')).toBeUndefined()
    expect(store.getTraceIdsByTopic('topic-a')).toEqual([])
  })
})
