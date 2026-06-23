import type { EntitySearchResponse } from '@shared/data/api/schemas/search'
import { describe, expect, it } from 'vitest'

import {
  buildGlobalMessageSearchGroups,
  buildGlobalSearchGroups,
  createRecentRouteEntryFromTab,
  createRecentSessionEntryFromSession,
  createRecentTopicEntryFromTopic,
  getGlobalSearchTypes,
  getMessageSearchSources,
  GLOBAL_MESSAGE_SEARCH_GROUP_COLLAPSED_LIMIT,
  GLOBAL_SEARCH_DISPLAY_RECENT_LIMIT,
  GLOBAL_SEARCH_ENTITY_GROUP_COLLAPSED_LIMIT,
  GLOBAL_SEARCH_MESSAGE_PREVIEW_LIMIT,
  GLOBAL_SEARCH_RECENT_ITEM_LIMIT,
  upsertGlobalSearchRecentEntry
} from '../globalSearchGroups'

describe('globalSearchGroups', () => {
  it('keeps recent items de-duplicated and capped by latest access', () => {
    const entries = Array.from({ length: GLOBAL_SEARCH_RECENT_ITEM_LIMIT }, (_, index) => ({
      kind: 'topic' as const,
      topicId: `topic-${index}`,
      title: `Topic ${index}`,
      lastAccessTime: index
    }))

    const next = upsertGlobalSearchRecentEntry(entries, {
      kind: 'topic',
      topicId: 'topic-10',
      title: 'Updated topic',
      lastAccessTime: 100
    })

    expect(next).toHaveLength(GLOBAL_SEARCH_RECENT_ITEM_LIMIT)
    expect(next[0]).toEqual({
      kind: 'topic',
      topicId: 'topic-10',
      title: 'Updated topic',
      lastAccessTime: 100
    })
    expect(next.filter((entry) => entry.kind === 'topic' && entry.topicId === 'topic-10')).toHaveLength(1)
  })

  it('preserves the recent items array reference when an upsert is structurally unchanged', () => {
    const entries = [
      {
        kind: 'topic' as const,
        topicId: 'topic-1',
        title: 'Topic 1',
        lastAccessTime: 20
      },
      {
        kind: 'session' as const,
        sessionId: 'session-1',
        title: 'Session 1',
        lastAccessTime: 10
      }
    ]

    const unchanged = upsertGlobalSearchRecentEntry(entries, {
      kind: 'topic',
      topicId: 'topic-1',
      title: 'Topic 1',
      lastAccessTime: 20
    })
    const changed = upsertGlobalSearchRecentEntry(entries, {
      kind: 'topic',
      topicId: 'topic-1',
      title: 'Topic 1',
      lastAccessTime: 30
    })

    expect(unchanged).toBe(entries)
    expect(changed).not.toBe(entries)
    expect(changed[0]).toEqual(expect.objectContaining({ kind: 'topic', topicId: 'topic-1', lastAccessTime: 30 }))
  })

  it('shows recent items only before a search query is entered', () => {
    const recentItems = Array.from({ length: GLOBAL_SEARCH_DISPLAY_RECENT_LIMIT + 1 }, (_, index) => ({
      kind: 'route' as const,
      url: `/app/item-${index}`,
      title: `Item ${index}`,
      lastAccessTime: 100 - index
    }))

    expect(
      buildGlobalSearchGroups({
        query: '',
        filter: 'all',
        recentItems,
        response: undefined
      })
    ).toEqual([
      expect.objectContaining({
        id: 'recent',
        items: expect.arrayContaining([expect.objectContaining({ id: 'route:/app/item-0' })])
      })
    ])

    const response: EntitySearchResponse = {
      query: 'agent',
      groups: [
        {
          type: 'assistant',
          items: [
            {
              type: 'assistant',
              id: 'assistant-1',
              title: 'Assistant',
              target: { assistantId: 'assistant-1' }
            }
          ]
        }
      ]
    }

    expect(
      buildGlobalSearchGroups({
        query: 'agent',
        filter: 'all',
        recentItems,
        response
      }).map((group) => group.id)
    ).toEqual(['assistant'])
  })

  it('includes knowledge bases in all search and supports knowledge filtering', () => {
    const response: EntitySearchResponse = {
      query: 'docs',
      groups: [
        {
          type: 'knowledge-base',
          items: [
            {
              type: 'knowledge-base',
              id: 'knowledge-1',
              title: 'Docs',
              target: { knowledgeBaseId: 'knowledge-1' }
            }
          ]
        }
      ]
    }

    expect(getGlobalSearchTypes('all')).toEqual(['topic', 'session', 'assistant', 'agent', 'knowledge-base'])
    expect(getGlobalSearchTypes('knowledge')).toEqual(['knowledge-base'])
    expect(
      buildGlobalSearchGroups({
        query: 'docs',
        filter: 'all',
        recentItems: [],
        response
      })
    ).toEqual([
      expect.objectContaining({
        id: 'knowledge-base',
        items: [expect.objectContaining({ id: 'knowledge-base:knowledge-1' })]
      })
    ])
  })

  it('creates entity-level recent entries and skips coarse chat routes', () => {
    expect(
      createRecentRouteEntryFromTab({
        id: 'chat',
        type: 'route',
        url: '/app/chat',
        title: 'Chat',
        lastAccessTime: 10
      })
    ).toBeNull()

    expect(
      createRecentTopicEntryFromTopic(
        {
          id: 'topic-1',
          name: 'Topic title'
        },
        20
      )
    ).toEqual({
      kind: 'topic',
      topicId: 'topic-1',
      title: 'Topic title',
      lastAccessTime: 20
    })

    expect(
      createRecentSessionEntryFromSession(
        {
          id: 'session-1',
          name: 'Session title'
        },
        30
      )
    ).toEqual({
      kind: 'session',
      sessionId: 'session-1',
      title: 'Session title',
      lastAccessTime: 30
    })
  })

  it('maps topic and session filters to separate search types and groups', () => {
    const response: EntitySearchResponse = {
      query: 'plan',
      groups: [
        {
          type: 'topic',
          items: [
            {
              type: 'topic',
              id: 'topic-1',
              title: 'Topic',
              target: { topicId: 'topic-1' }
            }
          ]
        },
        {
          type: 'session',
          items: [
            {
              type: 'session',
              id: 'session-1',
              title: 'Session',
              target: { sessionId: 'session-1', agentId: 'agent-1' }
            }
          ]
        }
      ]
    }

    expect(getGlobalSearchTypes('topic')).toEqual(['topic'])
    expect(getGlobalSearchTypes('session')).toEqual(['session'])
    expect(
      buildGlobalSearchGroups({
        query: 'plan',
        filter: 'topic',
        recentItems: [],
        response
      })
    ).toEqual([
      expect.objectContaining({
        id: 'topic',
        items: [expect.objectContaining({ id: 'topic:topic-1' })]
      })
    ])

    expect(
      buildGlobalSearchGroups({
        query: 'plan',
        filter: 'session',
        recentItems: [],
        response
      })
    ).toEqual([
      expect.objectContaining({
        id: 'session',
        items: [expect.objectContaining({ id: 'session:session-1' })]
      })
    ])

    expect(
      buildGlobalSearchGroups({
        query: 'plan',
        filter: 'all',
        recentItems: [],
        response
      }).map((group) => group.id)
    ).toEqual(['topic', 'session'])
  })

  it('collapses topic and session groups only in all search', () => {
    const response: EntitySearchResponse = {
      query: 'plan',
      groups: [
        {
          type: 'topic',
          items: Array.from({ length: GLOBAL_SEARCH_ENTITY_GROUP_COLLAPSED_LIMIT + 1 }, (_, index) => ({
            type: 'topic',
            id: `topic-${index}`,
            title: `Topic ${index}`,
            target: { topicId: `topic-${index}` }
          }))
        },
        {
          type: 'session',
          items: Array.from({ length: GLOBAL_SEARCH_ENTITY_GROUP_COLLAPSED_LIMIT + 1 }, (_, index) => ({
            type: 'session',
            id: `session-${index}`,
            title: `Session ${index}`,
            target: { sessionId: `session-${index}`, agentId: 'agent-1' }
          }))
        }
      ]
    }

    const collapsedGroups = buildGlobalSearchGroups({
      query: 'plan',
      filter: 'all',
      recentItems: [],
      response
    })

    expect(collapsedGroups[0]).toEqual(
      expect.objectContaining({
        id: 'topic',
        total: GLOBAL_SEARCH_ENTITY_GROUP_COLLAPSED_LIMIT + 1,
        items: expect.arrayContaining([expect.objectContaining({ id: 'topic:topic-0' })]),
        footer: expect.objectContaining({ kind: 'expand-results', remainingCount: 1 })
      })
    )
    expect(collapsedGroups[0]?.items).toHaveLength(GLOBAL_SEARCH_ENTITY_GROUP_COLLAPSED_LIMIT)
    expect(collapsedGroups[1]?.items).toHaveLength(GLOBAL_SEARCH_ENTITY_GROUP_COLLAPSED_LIMIT)

    const expandedGroups = buildGlobalSearchGroups({
      expandedGroupIds: new Set(['topic']),
      query: 'plan',
      filter: 'all',
      recentItems: [],
      response
    })
    expect(expandedGroups[0]?.items).toHaveLength(GLOBAL_SEARCH_ENTITY_GROUP_COLLAPSED_LIMIT + 1)
    expect(expandedGroups[0]?.footer).toBeUndefined()

    const filteredGroups = buildGlobalSearchGroups({
      query: 'plan',
      filter: 'topic',
      recentItems: [],
      response
    })
    expect(filteredGroups[0]?.items).toHaveLength(GLOBAL_SEARCH_ENTITY_GROUP_COLLAPSED_LIMIT + 1)
    expect(filteredGroups[0]?.footer).toBeUndefined()
  })

  it('adds a capped message preview group in all search', () => {
    const groups = buildGlobalSearchGroups({
      query: 'needle',
      filter: 'all',
      recentItems: [],
      response: { query: 'needle', groups: [] },
      messageItems: Array.from({ length: GLOBAL_SEARCH_MESSAGE_PREVIEW_LIMIT + 1 }, (_, index) => ({
        sourceType: 'topic' as const,
        messageId: `message-${index}`,
        topicId: 'topic-1',
        topicName: 'Topic',
        topicCreatedAt: '2026-01-01T00:00:00.000Z',
        topicUpdatedAt: '2026-01-01T00:00:00.000Z',
        snippet: `Snippet ${index}`,
        createdAt: `2026-01-01T00:00:0${index}.000Z`
      }))
    })

    expect(groups).toEqual([
      expect.objectContaining({
        id: 'message',
        total: GLOBAL_SEARCH_MESSAGE_PREVIEW_LIMIT + 1,
        items: expect.arrayContaining([
          expect.objectContaining({
            kind: 'message-parent',
            group: expect.objectContaining({ title: 'Topic', total: GLOBAL_SEARCH_MESSAGE_PREVIEW_LIMIT + 1 })
          }),
          expect.objectContaining({ id: 'message-preview:topic:topic-1:message-0' })
        ]),
        footer: { kind: 'open-message-search' }
      })
    ])
    expect(groups[0]?.items.filter((item) => item.kind === 'message')).toHaveLength(GLOBAL_SEARCH_MESSAGE_PREVIEW_LIMIT)
  })

  it('maps message search source filters and groups message results by parent', () => {
    expect(getMessageSearchSources('all')).toEqual(['topic', 'session'])
    expect(getMessageSearchSources('topic')).toEqual(['topic'])
    expect(getMessageSearchSources('session')).toEqual(['session'])

    const groups = buildGlobalMessageSearchGroups({
      expandedParentIds: new Set(),
      items: [
        ...Array.from({ length: GLOBAL_MESSAGE_SEARCH_GROUP_COLLAPSED_LIMIT + 1 }, (_, index) => ({
          sourceType: 'topic' as const,
          messageId: `message-${index}`,
          topicId: 'topic-1',
          topicName: 'Topic',
          topicCreatedAt: '2026-01-01T00:00:00.000Z',
          topicUpdatedAt: '2026-01-01T00:00:00.000Z',
          snippet: `Snippet ${index}`,
          createdAt: `2026-01-01T00:00:0${index}.000Z`
        })),
        {
          sourceType: 'session',
          messageId: 'session-message-1',
          sessionId: 'session-1',
          sessionName: 'Session',
          snippet: 'Session snippet',
          createdAt: '2026-01-01T00:00:10.000Z'
        }
      ]
    })

    expect(groups).toHaveLength(2)
    expect(groups[0]).toEqual(
      expect.objectContaining({
        id: 'topic:topic-1',
        sourceType: 'topic',
        title: 'Topic',
        total: GLOBAL_MESSAGE_SEARCH_GROUP_COLLAPSED_LIMIT + 1,
        items: expect.arrayContaining([expect.objectContaining({ kind: 'more', remainingCount: 1 })])
      })
    )
    expect(groups[1]).toEqual(
      expect.objectContaining({
        id: 'session:session-1',
        sourceType: 'session',
        title: 'Session',
        total: 1
      })
    )
  })

  it('orders messages from oldest to newest within each message search group', () => {
    const groups = buildGlobalMessageSearchGroups({
      expandedParentIds: new Set(['topic:topic-1']),
      items: [
        {
          sourceType: 'topic',
          messageId: 'message-late',
          topicId: 'topic-1',
          topicName: 'Topic',
          topicCreatedAt: '2026-01-01T00:00:00.000Z',
          topicUpdatedAt: '2026-01-01T00:00:00.000Z',
          snippet: 'Late snippet',
          createdAt: '2026-01-01T00:00:30.000Z'
        },
        {
          sourceType: 'topic',
          messageId: 'message-early',
          topicId: 'topic-1',
          topicName: 'Topic',
          topicCreatedAt: '2026-01-01T00:00:00.000Z',
          topicUpdatedAt: '2026-01-01T00:00:00.000Z',
          snippet: 'Early snippet',
          createdAt: '2026-01-01T00:00:10.000Z'
        },
        {
          sourceType: 'topic',
          messageId: 'message-middle',
          topicId: 'topic-1',
          topicName: 'Topic',
          topicCreatedAt: '2026-01-01T00:00:00.000Z',
          topicUpdatedAt: '2026-01-01T00:00:00.000Z',
          snippet: 'Middle snippet',
          createdAt: '2026-01-01T00:00:20.000Z'
        }
      ]
    })

    expect(
      groups[0]?.items
        .filter((item) => item.kind === 'message')
        .map((item) => (item.kind === 'message' ? item.result.messageId : item.id))
    ).toEqual(['message-early', 'message-middle', 'message-late'])
  })
})
