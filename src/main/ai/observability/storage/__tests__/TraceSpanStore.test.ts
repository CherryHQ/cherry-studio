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
