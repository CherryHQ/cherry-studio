import {
  AGENT_SESSION_MESSAGE_SEARCH_ROLES,
  type AgentSessionMessageSearchRole,
  TOPIC_MESSAGE_SEARCH_ROLES,
  type TopicMessageSearchRole
} from '@shared/data/types/message'
import { describe, expect, expectTypeOf, it } from 'vitest'

import {
  CONTENT_SEARCH_MAX_LIMIT_PER_SOURCE,
  type ContentSearchGroup,
  ContentSearchQuerySchema,
  contentSearchSourceTypes,
  ENTITY_SEARCH_MAX_LIMIT_PER_TYPE,
  type EntitySearchGroup,
  type EntitySearchItem,
  EntitySearchQuerySchema,
  type SessionMessageContentSearchItem,
  type TopicMessageContentSearchItem
} from '../search'

describe('EntitySearchQuerySchema', () => {
  it('trims q without applying a default limit', () => {
    expect(EntitySearchQuerySchema.parse({ q: '  assistant  ' })).toEqual({
      q: 'assistant'
    })
  })

  it('accepts type filters and explicit positive limitPerType', () => {
    expect(
      EntitySearchQuerySchema.parse({
        q: 'agent',
        types: ['agent', 'session'],
        updatedAtFrom: '2026-05-01T00:00:00.000Z',
        limitPerType: ENTITY_SEARCH_MAX_LIMIT_PER_TYPE
      })
    ).toEqual({
      q: 'agent',
      types: ['agent', 'session'],
      updatedAtFrom: '2026-05-01T00:00:00.000Z',
      limitPerType: ENTITY_SEARCH_MAX_LIMIT_PER_TYPE
    })
  })

  it('rejects blank q, invalid updatedAtFrom, out-of-range limits, and message flags', () => {
    expect(() => EntitySearchQuerySchema.parse({ q: '   ' })).toThrow()
    expect(() => EntitySearchQuerySchema.parse({ q: 'agent', updatedAtFrom: 'today' })).toThrow()
    expect(() => EntitySearchQuerySchema.parse({ q: 'agent', limitPerType: 0 })).toThrow()
    expect(() =>
      EntitySearchQuerySchema.parse({ q: 'agent', limitPerType: ENTITY_SEARCH_MAX_LIMIT_PER_TYPE + 1 })
    ).toThrow()
    expect(() => EntitySearchQuerySchema.parse({ q: 'agent', includeMessages: true })).toThrow()
  })

  it('narrows target by result type at compile time', () => {
    const assertItemNarrowing = (item: EntitySearchItem) => {
      if (item.type === 'assistant') {
        expectTypeOf(item.target).toEqualTypeOf<{ assistantId: string }>()
      }
      if (item.type === 'topic') {
        expectTypeOf(item.target).toEqualTypeOf<{ topicId: string; assistantId?: string }>()
      }
      if (item.type === 'session') {
        expectTypeOf(item.target).toEqualTypeOf<{ sessionId: string; agentId: string | null }>()
      }
    }

    const assertGroupNarrowing = (group: EntitySearchGroup) => {
      if (group.type === 'assistant') {
        expectTypeOf(group.items).toEqualTypeOf<Array<Extract<EntitySearchItem, { type: 'assistant' }>>>()
      }
      if (group.type === 'topic') {
        expectTypeOf(group.items).toEqualTypeOf<Array<Extract<EntitySearchItem, { type: 'topic' }>>>()
      }
      if (group.type === 'session') {
        expectTypeOf(group.items).toEqualTypeOf<Array<Extract<EntitySearchItem, { type: 'session' }>>>()
      }
    }

    expect(assertItemNarrowing).toBeTypeOf('function')
    expect(assertGroupNarrowing).toBeTypeOf('function')
  })
})

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
    expect(() => ContentSearchQuerySchema.parse({ q: 'message', cursors: { 'topic-message': '' } })).toThrow()
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

  it('derives result role types from shared search role allowlists', () => {
    expect(TOPIC_MESSAGE_SEARCH_ROLES).toEqual(['user', 'assistant'])
    expect(AGENT_SESSION_MESSAGE_SEARCH_ROLES).toEqual(['user', 'assistant', 'system'])
    expectTypeOf<TopicMessageContentSearchItem['role']>().toEqualTypeOf<TopicMessageSearchRole | undefined>()
    expectTypeOf<SessionMessageContentSearchItem['role']>().toEqualTypeOf<AgentSessionMessageSearchRole | undefined>()
  })
})
