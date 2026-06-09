import { DataApiErrorFactory } from '@shared/data/api'
import {
  CONTENT_SEARCH_DEFAULT_LIMIT_PER_SOURCE,
  CONTENT_SEARCH_MAX_LIMIT_PER_SOURCE,
  ContentSearchQuerySchema,
  contentSearchSourceTypes,
  type SessionMessageContentSearchItem,
  type TopicMessageContentSearchItem
} from '@shared/data/api/schemas/search'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { topicSearchMock, sessionSearchMock } = vi.hoisted(() => ({
  topicSearchMock: vi.fn(),
  sessionSearchMock: vi.fn()
}))

vi.mock('@data/services/MessageService', () => ({
  messageService: {
    search: topicSearchMock
  }
}))

vi.mock('@data/services/AgentSessionMessageService', () => ({
  agentSessionMessageService: {
    search: sessionSearchMock
  }
}))

import { CONTENT_SEARCH_SOURCE_ADAPTERS, ContentSearchService } from '../ContentSearchService'

const topicItem: TopicMessageContentSearchItem = {
  messageId: 'topic-message-1',
  topicId: 'topic-1',
  topicName: 'Topic One',
  role: 'assistant',
  topicCreatedAt: '2026-05-01T00:00:00.000Z',
  topicUpdatedAt: '2026-05-02T00:00:00.000Z',
  snippet: 'needle topic',
  createdAt: '2026-05-03T00:00:00.000Z'
}

const sessionItem: SessionMessageContentSearchItem = {
  messageId: 'session-message-1',
  sessionId: 'session-1',
  sessionName: 'Session One',
  agentId: 'agent-1',
  agentName: 'Agent One',
  role: 'assistant',
  snippet: 'needle session',
  createdAt: '2026-05-04T00:00:00.000Z'
}

describe('ContentSearchService', () => {
  let service: ContentSearchService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new ContentSearchService()
  })

  it('keeps the adapter registry exhaustive for every content source type', () => {
    expect(Object.keys(CONTENT_SEARCH_SOURCE_ADAPTERS)).toEqual([...contentSearchSourceTypes])
  })

  it('runs every source by default and returns grouped cursors', async () => {
    topicSearchMock.mockResolvedValueOnce({ items: [topicItem], nextCursor: '200:topic-message-1' })
    sessionSearchMock.mockResolvedValueOnce({ items: [sessionItem], nextCursor: '300:session-message-1' })

    const result = await service.search(
      ContentSearchQuerySchema.parse({
        q: '  needle  ',
        limitPerSource: 2,
        createdAtFrom: '2026-05-01T00:00:00.000Z'
      })
    )

    expect(topicSearchMock).toHaveBeenCalledWith({
      q: 'needle',
      cursor: undefined,
      limit: 2,
      createdAtFrom: '2026-05-01T00:00:00.000Z'
    })
    expect(sessionSearchMock).toHaveBeenCalledWith({
      q: 'needle',
      cursor: undefined,
      limit: 2,
      createdAtFrom: '2026-05-01T00:00:00.000Z'
    })
    expect(result).toEqual({
      query: 'needle',
      groups: [
        { sourceType: 'topic-message', items: [topicItem], nextCursor: '200:topic-message-1' },
        { sourceType: 'session-message', items: [sessionItem], nextCursor: '300:session-message-1' }
      ]
    })
  })

  it('runs only the requested source for single-group load more', async () => {
    sessionSearchMock.mockResolvedValueOnce({ items: [sessionItem], nextCursor: undefined })

    const result = await service.search(
      ContentSearchQuerySchema.parse({
        q: 'needle',
        sources: ['session-message'],
        cursors: { 'session-message': '300:session-message-1' },
        filters: { 'session-message': { sessionId: 'session-1' } },
        limitPerSource: 1
      })
    )

    expect(topicSearchMock).not.toHaveBeenCalled()
    expect(sessionSearchMock).toHaveBeenCalledWith({
      q: 'needle',
      sessionId: 'session-1',
      cursor: '300:session-message-1',
      limit: 1,
      createdAtFrom: undefined
    })
    expect(result.groups).toEqual([{ sourceType: 'session-message', items: [sessionItem], nextCursor: undefined }])
  })

  it('passes only the matching source filter to each adapter', async () => {
    topicSearchMock.mockResolvedValueOnce({ items: [topicItem], nextCursor: undefined })
    sessionSearchMock.mockResolvedValueOnce({ items: [sessionItem], nextCursor: undefined })

    await service.search(
      ContentSearchQuerySchema.parse({
        q: 'needle',
        filters: {
          'topic-message': { topicId: 'topic-1' },
          'session-message': { sessionId: 'session-1' }
        }
      })
    )

    expect(topicSearchMock).toHaveBeenCalledWith({
      q: 'needle',
      topicId: 'topic-1',
      cursor: undefined,
      limit: CONTENT_SEARCH_DEFAULT_LIMIT_PER_SOURCE,
      createdAtFrom: undefined
    })
    expect(sessionSearchMock).toHaveBeenCalledWith({
      q: 'needle',
      sessionId: 'session-1',
      cursor: undefined,
      limit: CONTENT_SEARCH_DEFAULT_LIMIT_PER_SOURCE,
      createdAtFrom: undefined
    })
  })

  it('passes only the matching per-source cursor to each adapter', async () => {
    topicSearchMock.mockResolvedValueOnce({ items: [topicItem], nextCursor: undefined })
    sessionSearchMock.mockResolvedValueOnce({ items: [sessionItem], nextCursor: undefined })

    await service.search(
      ContentSearchQuerySchema.parse({
        q: 'needle',
        cursors: { 'topic-message': '200:topic-message-1' }
      })
    )

    expect(topicSearchMock).toHaveBeenCalledWith({
      q: 'needle',
      cursor: '200:topic-message-1',
      limit: CONTENT_SEARCH_DEFAULT_LIMIT_PER_SOURCE,
      createdAtFrom: undefined
    })
    expect(sessionSearchMock).toHaveBeenCalledWith({
      q: 'needle',
      cursor: undefined,
      limit: CONTENT_SEARCH_DEFAULT_LIMIT_PER_SOURCE,
      createdAtFrom: undefined
    })
  })

  it('clamps direct service limitPerSource above the maximum', async () => {
    topicSearchMock.mockResolvedValueOnce({ items: [topicItem], nextCursor: undefined })

    await service.search({
      q: 'needle',
      sources: ['topic-message'],
      limitPerSource: CONTENT_SEARCH_MAX_LIMIT_PER_SOURCE + 1
    })

    expect(topicSearchMock).toHaveBeenCalledWith({
      q: 'needle',
      cursor: undefined,
      limit: CONTENT_SEARCH_MAX_LIMIT_PER_SOURCE,
      createdAtFrom: undefined
    })
  })

  it('reports malformed cursors on the source-specific cursor field', async () => {
    topicSearchMock.mockRejectedValueOnce(
      DataApiErrorFactory.validation({ cursor: ['must be a valid message cursor'] }, 'Invalid message cursor')
    )

    await expect(
      service.search(
        ContentSearchQuerySchema.parse({
          q: 'needle',
          sources: ['topic-message'],
          cursors: { 'topic-message': 'not-a-cursor' }
        })
      )
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'Invalid message cursor',
      details: {
        fieldErrors: {
          'cursors.topic-message': ['must be a valid message cursor']
        }
      }
    })
  })

  it('fails the full query with source context when a source has a non-cursor error', async () => {
    topicSearchMock.mockRejectedValueOnce(new Error('database is busy'))
    sessionSearchMock.mockResolvedValueOnce({ items: [sessionItem], nextCursor: undefined })

    await expect(
      service.search(
        ContentSearchQuerySchema.parse({
          q: 'needle'
        })
      )
    ).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      message: expect.stringContaining('content search source topic-message')
    })

    expect(sessionSearchMock).toHaveBeenCalled()
  })
})
