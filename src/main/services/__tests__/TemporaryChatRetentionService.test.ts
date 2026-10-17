import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { messageTable } from '@data/db/schemas/message'
import { topicTable } from '@data/db/schemas/topic'
import { temporaryChatService } from '@data/services/TemporaryChatService'
import { topicService } from '@data/services/TopicService'
import { BaseService } from '@main/core/lifecycle'
import { TEMPORARY_CHAT_LIFETIME_MS } from '@shared/data/api/schemas/temporaryChats'

import { TemporaryChatRetentionService } from '../TemporaryChatRetentionService'

vi.mock('@data/dataApiDataChange', () => ({ notifyDataApiDataChange: vi.fn() }))

const mockedGet = vi.mocked(application.get)
const defaultGet = mockedGet.getMockImplementation()!
const createdAt = new Date('2026-10-13T10:00:00Z').getTime()
const streams = {
  withDispatchLock: vi.fn(async (_id: string, run: () => Promise<unknown>) => run()),
  hasUnsettledTopicWork: vi.fn(() => false),
  abort: vi.fn()
}

describe('temporary retention', () => {
  const dbh = setupTestDatabase()
  let service: TemporaryChatRetentionService

  beforeEach(() => {
    BaseService.resetInstances()
    vi.spyOn(Date, 'now').mockReturnValue(createdAt)
    mockedGet.mockImplementation(((name: string) =>
      name === 'AiStreamManager' ? streams : defaultGet(name as never)) as typeof defaultGet)
    streams.hasUnsettledTopicWork.mockReturnValue(false)
    streams.abort.mockClear()
    service = new TemporaryChatRetentionService()
  })
  afterEach(() => {
    mockedGet.mockImplementation(defaultGet)
    vi.restoreAllMocks()
  })

  const retain = (temporary = true) => {
    const topic = temporaryChatService.createTopic({ name: 'Question' })
    temporaryChatService.appendMessage(topic.id, {
      role: 'user',
      data: { parts: [{ type: 'text', text: 'Where is Paris?' }] }
    })
    temporaryChatService.persist(topic.id, temporary)
    return topic.id
  }

  it('retains messages and mode until the fixed deadline, then deletes only temporary data', async () => {
    const temp = retain()
    const permanent = retain(false)
    expect(topicService.getById(temp).expiresAt).toBe(new Date(createdAt + TEMPORARY_CHAT_LIFETIME_MS).toISOString())
    vi.mocked(Date.now).mockReturnValue(createdAt + TEMPORARY_CHAT_LIFETIME_MS - 1)
    await service.expireTopics()
    expect(topicService.getById(temp).id).toBe(temp)
    vi.mocked(Date.now).mockReturnValue(createdAt + TEMPORARY_CHAT_LIFETIME_MS)
    await service.expireTopics()
    expect(dbh.db.select().from(topicTable).where(eq(topicTable.id, temp)).all()).toEqual([])
    expect(dbh.db.select().from(messageTable).where(eq(messageTable.topicId, temp)).all()).toEqual([])
    expect(topicService.getById(permanent).expiresAt).toBeUndefined()
    expect(application.get('IpcApiService').broadcast).toHaveBeenCalledWith('quick_assistant.chat.expired', {
      topicIds: [temp]
    })
  })

  it('keeping a temporary topic makes it permanent without copying its conversation', async () => {
    const id = retain()
    const messages = dbh.db.select().from(messageTable).where(eq(messageTable.topicId, id)).all()
    expect(topicService.persist(id).expiresAt).toBeUndefined()
    vi.mocked(Date.now).mockReturnValue(createdAt + 2 * TEMPORARY_CHAT_LIFETIME_MS)
    await service.expireTopics()
    expect(topicService.getById(id).id).toBe(id)
    expect(dbh.db.select().from(messageTable).where(eq(messageTable.topicId, id)).all()).toEqual(messages)
  })

  it('aborts unsettled generation before purging an expired conversation', async () => {
    const id = retain()
    vi.mocked(Date.now).mockReturnValue(createdAt + TEMPORARY_CHAT_LIFETIME_MS)
    streams.hasUnsettledTopicWork.mockReturnValue(true)
    await service.expireTopics()
    expect(streams.abort).toHaveBeenCalledWith(id, 'Temporary chat expired')
    expect(dbh.db.select().from(topicTable).where(eq(topicTable.id, id)).all()).toHaveLength(1)
    streams.hasUnsettledTopicWork.mockReturnValue(false)
    await service.expireTopics()
    expect(dbh.db.select().from(topicTable).where(eq(topicTable.id, id)).all()).toEqual([])
  })

  it('rejects saving or reopening a temporary chat past its deadline', () => {
    const id = retain()
    vi.mocked(Date.now).mockReturnValue(createdAt + TEMPORARY_CHAT_LIFETIME_MS)
    expect(() => topicService.getById(id)).toThrow()
    expect(() => topicService.persist(id)).toThrow()
  })

  it('expires in-memory chats too', async () => {
    const topic = temporaryChatService.createTopic({ name: 'Scratch' })
    vi.mocked(Date.now).mockReturnValue(createdAt + TEMPORARY_CHAT_LIFETIME_MS)
    await service.expireTopics()
    expect(temporaryChatService.hasTopic(topic.id)).toBe(false)
  })
})
