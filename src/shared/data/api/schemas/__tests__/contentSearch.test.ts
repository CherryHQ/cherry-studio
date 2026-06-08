import { describe, expect, expectTypeOf, it } from 'vitest'

import {
  CONTENT_SEARCH_MAX_LIMIT_PER_SOURCE,
  type ContentSearchGroup,
  ContentSearchQuerySchema,
  contentSearchSourceTypes,
  type SessionMessageContentSearchItem,
  type TopicMessageContentSearchItem
} from '../search'

describe('ContentSearchQuerySchema', () => {
  it('trims q without applying a default limit', () => {
    expect(ContentSearchQuerySchema.parse({ q: '  message  ' })).toEqual({
      q: 'message'
    })
  })

  it('accepts source filters, per-source cursors, time, and explicit limitPerSource', () => {
    expect(
      ContentSearchQuerySchema.parse({
        q: 'needle',
        sources: ['topic-message', 'session-message'],
        cursors: { 'topic-message': '200:message-1' },
        filters: {
          'topic-message': { topicId: 'topic-1' },
          'session-message': { sessionId: 'session-1' }
        },
        createdAtFrom: '2026-05-01T00:00:00.000Z',
        limitPerSource: CONTENT_SEARCH_MAX_LIMIT_PER_SOURCE
      })
    ).toEqual({
      q: 'needle',
      sources: ['topic-message', 'session-message'],
      cursors: { 'topic-message': '200:message-1' },
      filters: {
        'topic-message': { topicId: 'topic-1' },
        'session-message': { sessionId: 'session-1' }
      },
      createdAtFrom: '2026-05-01T00:00:00.000Z',
      limitPerSource: CONTENT_SEARCH_MAX_LIMIT_PER_SOURCE
    })
  })

  it('rejects blank q, invalid sources, invalid filters, invalid createdAtFrom, and out-of-range limits', () => {
    expect(() => ContentSearchQuerySchema.parse({ q: '   ' })).toThrow()
    expect(() => ContentSearchQuerySchema.parse({ q: 'message', sources: ['topic'] })).toThrow()
    expect(() => ContentSearchQuerySchema.parse({ q: 'message', cursors: { topic: '1:m1' } })).toThrow()
    expect(() =>
      ContentSearchQuerySchema.parse({ q: 'message', filters: { 'topic-message': { sessionId: 'session-1' } } })
    ).toThrow()
    expect(() =>
      ContentSearchQuerySchema.parse({ q: 'message', filters: { 'session-message': { topicId: 'topic-1' } } })
    ).toThrow()
    expect(() =>
      ContentSearchQuerySchema.parse({ q: 'message', filters: { 'knowledge-item': { knowledgeBaseId: 'kb-1' } } })
    ).toThrow()
    expect(() => ContentSearchQuerySchema.parse({ q: 'message', createdAtFrom: 'today' })).toThrow()
    expect(() => ContentSearchQuerySchema.parse({ q: 'message', limitPerSource: 0 })).toThrow()
    expect(() =>
      ContentSearchQuerySchema.parse({ q: 'message', limitPerSource: CONTENT_SEARCH_MAX_LIMIT_PER_SOURCE + 1 })
    ).toThrow()
  })

  it('keeps the source tuple and grouped response union in lockstep', () => {
    expect(contentSearchSourceTypes).toEqual(['topic-message', 'session-message'])

    const assertNarrowing = (group: ContentSearchGroup) => {
      if (group.sourceType === 'topic-message') {
        expectTypeOf(group.items).toEqualTypeOf<TopicMessageContentSearchItem[]>()
      }
      if (group.sourceType === 'session-message') {
        expectTypeOf(group.items).toEqualTypeOf<SessionMessageContentSearchItem[]>()
      }
    }

    expect(assertNarrowing).toBeTypeOf('function')
  })
})
