import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { messageService } from '@data/services/MessageService'
import { topicService } from '@data/services/TopicService'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import type { AbsoluteFilePath } from '@shared/types/file'

import { type ChatRecordCandidate, collectChatRecords, stageChatRecords } from '../chatRecordCollector'

vi.mock('@data/services/AgentSessionMessageService', () => ({
  agentSessionMessageService: { getSessionMessage: vi.fn(), listCreatedInRangeMetadataPage: vi.fn() }
}))
vi.mock('@data/services/AgentSessionService', () => ({
  agentSessionService: { getById: vi.fn() }
}))
vi.mock('@data/services/MessageService', () => ({
  messageService: { getById: vi.fn(), listLiveCreatedInRangeMetadataPage: vi.fn() }
}))
vi.mock('@data/services/TopicService', () => ({
  topicService: { getById: vi.fn() }
}))

const normalTopic = {
  id: 'topic-1',
  name: 'Topic',
  isNameManuallyEdited: false,
  orderKey: 'a0',
  lastActivityAt: '2026-08-25T00:00:00.000Z',
  createdAt: '2026-08-24T00:00:00.000Z',
  updatedAt: '2026-08-25T00:00:00.000Z'
}

const normalMessages = [
  {
    id: 'message-new',
    topicId: normalTopic.id,
    parentId: null,
    role: 'user',
    data: {
      parts: [
        { type: 'text', text: '你好🙂' },
        { type: 'file', fileEntryId: 'attachment-id' }
      ]
    },
    searchableText: '你好🙂',
    status: 'success',
    siblingsGroupId: 0,
    createdAt: '2026-08-25T00:02:00.000Z',
    updatedAt: '2026-08-25T00:02:00.000Z'
  },
  {
    id: 'message-old',
    topicId: normalTopic.id,
    parentId: 'message-new',
    role: 'assistant',
    data: { parts: [{ type: 'text', text: 'reply' }] },
    searchableText: 'reply',
    status: 'success',
    siblingsGroupId: 0,
    createdAt: '2026-08-25T00:00:00.000Z',
    updatedAt: '2026-08-25T00:00:00.000Z'
  }
]

const agentSession = {
  id: 'session-1',
  agentId: 'agent-1',
  name: 'Agent session',
  isNameManuallyEdited: false,
  workspaceId: 'workspace-1',
  workspace: { id: 'workspace-1', type: 'managed', path: '/workspace' },
  orderKey: 'a0',
  lastActivityAt: '2026-08-25T00:01:00.000Z',
  createdAt: '2026-08-24T00:00:00.000Z',
  updatedAt: '2026-08-25T00:01:00.000Z'
}

const agentMessage = {
  id: 'agent-message-1',
  sessionId: agentSession.id,
  role: 'assistant',
  data: { parts: [{ type: 'text', text: 'agent reply' }] },
  searchableText: 'agent reply',
  status: 'success',
  modelId: 'provider::model',
  messageSnapshot: null,
  stats: null,
  runtimeResumeToken: 'runtime-resume-token',
  delivery: { status: 'accepted', turnRef: 'turn-1' },
  createdAt: '2026-08-25T00:01:00.000Z',
  updatedAt: '2026-08-25T00:01:00.000Z'
}

const normalMessageMetadata = normalMessages.map(({ createdAt, id, topicId, ...entity }) => ({
  createdAt,
  entityJsonBytes: Buffer.byteLength(JSON.stringify({ id, topicId, ...entity, createdAt }), 'utf8'),
  id,
  topicId
}))

const agentMessageMetadata = {
  createdAt: agentMessage.createdAt,
  entityJsonBytes: Buffer.byteLength(JSON.stringify(agentMessage), 'utf8'),
  id: agentMessage.id,
  sessionId: agentMessage.sessionId
}

function jsonlBytes(...entities: unknown[]): number {
  return entities.reduce<number>((bytes, entity) => bytes + Buffer.byteLength(`${JSON.stringify(entity)}\n`, 'utf8'), 0)
}

describe('chat record collection', () => {
  let tempRoot: AbsoluteFilePath

  async function collectCandidates(collection: ReturnType<typeof collectChatRecords>) {
    const candidates: ChatRecordCandidate[] = []
    for await (const candidate of collection.candidates) candidates.push(candidate)
    return candidates
  }

  beforeEach(async () => {
    tempRoot = (await mkdtemp(path.join(tmpdir(), 'diagnostic-chat-records-'))) as AbsoluteFilePath
    vi.mocked(messageService.listLiveCreatedInRangeMetadataPage).mockReturnValue({
      items: normalMessageMetadata,
      nextCursor: undefined
    })
    vi.mocked(messageService.getById).mockImplementation(
      (id) => normalMessages.find((message) => message.id === id) as never
    )
    vi.mocked(topicService.getById).mockReturnValue(normalTopic)
    vi.mocked(agentSessionMessageService.listCreatedInRangeMetadataPage).mockReturnValue({
      items: [agentMessageMetadata],
      nextCursor: undefined
    })
    vi.mocked(agentSessionMessageService.getSessionMessage).mockReturnValue(agentMessage as never)
    vi.mocked(agentSessionService.getById).mockReturnValue(agentSession as never)
  })

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true })
    vi.clearAllMocks()
  })

  it('collects metadata without message bodies and hydrates only while staging UTF-8 JSONL', async () => {
    const collection = collectChatRecords({ fromMs: 1_000, toMs: 2_000 })
    const candidates = await collectCandidates(collection)
    const expectedBytes = jsonlBytes(normalTopic, ...normalMessages, agentSession, agentMessage)

    expect(candidates).toHaveLength(3)
    expect(candidates[0]).toMatchObject({
      messageRecord: { archiveName: 'chats/messages.jsonl', key: 'message:message-new' },
      source: 'normal-chat'
    })
    expect(messageService.getById).not.toHaveBeenCalled()
    expect(agentSessionMessageService.getSessionMessage).not.toHaveBeenCalled()

    const result = await stageChatRecords(candidates, tempRoot, 1024 * 1024)
    const staged = result.sources

    expect(staged).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ archiveName: 'chats/topics.jsonl', kind: 'chatRecords', malformedLineCount: 0 }),
        expect.objectContaining({ archiveName: 'chats/messages.jsonl', kind: 'chatRecords', malformedLineCount: 0 }),
        expect.objectContaining({
          archiveName: 'chats/agent-sessions.jsonl',
          kind: 'chatRecords',
          malformedLineCount: 0
        }),
        expect.objectContaining({
          archiveName: 'chats/agent-session-messages.jsonl',
          kind: 'chatRecords',
          malformedLineCount: 0
        })
      ])
    )
    expect(staged).toHaveLength(4)
    expect(result.included).toEqual({ bytes: expectedBytes, messageCount: 3, recordCount: 5 })
    expect(result.observedByteDelta).toBe(0)
    expect(result.warnings).toEqual(new Set())
    expect(messageService.getById).toHaveBeenCalledTimes(2)
    expect(agentSessionMessageService.getSessionMessage).toHaveBeenCalledTimes(1)
    expect(await readdir(path.join(tempRoot, 'chats'))).toEqual([
      'agent-session-messages.jsonl',
      'agent-sessions.jsonl',
      'messages.jsonl',
      'topics.jsonl'
    ])

    const stagedTopicLines = (await readFile(path.join(tempRoot, 'chats/topics.jsonl'), 'utf8')).trim().split('\n')
    const stagedMessageLines = (await readFile(path.join(tempRoot, 'chats/messages.jsonl'), 'utf8')).trim().split('\n')
    expect(stagedTopicLines.map((line) => JSON.parse(line))).toEqual([normalTopic])
    expect(stagedMessageLines.map((line) => JSON.parse(line))).toEqual(normalMessages)
    expect(await readFile(path.join(tempRoot, 'chats/agent-sessions.jsonl'), 'utf8')).toBe(
      `${JSON.stringify(agentSession)}\n`
    )
    expect(await readFile(path.join(tempRoot, 'chats/agent-session-messages.jsonl'), 'utf8')).toBe(
      `${JSON.stringify(agentMessage)}\n`
    )
    expect(staged.map((source) => source.bytes)).toEqual(
      await Promise.all(staged.map(async (source) => (await readFile(source.path)).length))
    )
  })

  it('loads later pages on demand and keeps global newest-first order', async () => {
    vi.mocked(messageService.listLiveCreatedInRangeMetadataPage)
      .mockReturnValueOnce({ items: [normalMessageMetadata[0]], nextCursor: 'normal-next' })
      .mockReturnValueOnce({ items: [normalMessageMetadata[1]], nextCursor: undefined })
    vi.mocked(agentSessionMessageService.listCreatedInRangeMetadataPage).mockReturnValue({
      items: [agentMessageMetadata],
      nextCursor: undefined
    })

    const iterator = collectChatRecords({ fromMs: 1_000, toMs: 2_000 }).candidates[Symbol.asyncIterator]()

    await expect(iterator.next()).resolves.toMatchObject({ value: { id: 'message:message-new' } })
    expect(messageService.listLiveCreatedInRangeMetadataPage).toHaveBeenCalledTimes(1)
    await expect(iterator.next()).resolves.toMatchObject({ value: { id: 'agent-session-message:agent-message-1' } })
    await expect(iterator.next()).resolves.toMatchObject({ value: { id: 'message:message-old' } })
    expect(messageService.listLiveCreatedInRangeMetadataPage).toHaveBeenNthCalledWith(2, {
      fromMs: 1_000,
      toMs: 2_000,
      cursor: 'normal-next',
      limit: expect.any(Number)
    })
  })

  it('keeps the readable chat family when the other family cannot be read', async () => {
    vi.mocked(messageService.listLiveCreatedInRangeMetadataPage).mockImplementation(() => {
      throw new Error('normal chat unavailable')
    })

    const collection = collectChatRecords({ fromMs: 1_000, toMs: 2_000 })
    const candidates = await collectCandidates(collection)

    expect(collection.warnings).toEqual(new Set(['source_unreadable']))
    expect(candidates).toHaveLength(1)
    const result = await stageChatRecords(candidates, tempRoot, 1024 * 1024)
    expect(await readFile(path.join(tempRoot, 'chats/agent-session-messages.jsonl'), 'utf8')).toBe(
      `${JSON.stringify(agentMessage)}\n`
    )
    expect(result.included).toEqual({
      bytes: Buffer.byteLength(`${JSON.stringify(agentMessage)}\n${JSON.stringify(agentSession)}\n`, 'utf8'),
      messageCount: 1,
      recordCount: 2
    })
  })

  it('continues collecting normal chat candidates after a topic is deleted', async () => {
    const readableTopic = { ...normalTopic, id: 'topic-readable' }
    const messages = [
      { ...normalMessages[0], id: 'message-missing-topic', topicId: 'topic-missing' },
      { ...normalMessages[1], id: 'message-readable-topic', topicId: readableTopic.id }
    ]
    vi.mocked(messageService.listLiveCreatedInRangeMetadataPage).mockReturnValue({
      items: messages.map(({ createdAt, id, topicId, ...entity }) => ({
        createdAt,
        entityJsonBytes: Buffer.byteLength(JSON.stringify({ id, topicId, ...entity, createdAt }), 'utf8'),
        id,
        topicId
      })),
      nextCursor: undefined
    })
    vi.mocked(topicService.getById).mockImplementation((id) => {
      if (id === 'topic-missing') throw DataApiErrorFactory.notFound('Topic', id)
      return readableTopic
    })
    vi.mocked(agentSessionMessageService.listCreatedInRangeMetadataPage).mockReturnValue({
      items: [],
      nextCursor: undefined
    })

    const collection = collectChatRecords({ fromMs: 1_000, toMs: 2_000 })
    const candidates = await collectCandidates(collection)

    expect(candidates.map((candidate) => candidate.id)).toEqual(['message:message-readable-topic'])
    expect(collection.warnings).toEqual(new Set(['source_changed']))
  })

  it('continues collecting agent session candidates after a session is deleted', async () => {
    const readableSession = { ...agentSession, id: 'session-readable' }
    const messages = [
      { ...agentMessage, id: 'agent-message-missing-session', sessionId: 'session-missing' },
      { ...agentMessage, id: 'agent-message-readable-session', sessionId: readableSession.id }
    ]
    vi.mocked(messageService.listLiveCreatedInRangeMetadataPage).mockReturnValue({
      items: [],
      nextCursor: undefined
    })
    vi.mocked(agentSessionMessageService.listCreatedInRangeMetadataPage).mockReturnValue({
      items: messages.map((message) => ({
        createdAt: message.createdAt,
        entityJsonBytes: Buffer.byteLength(JSON.stringify(message), 'utf8'),
        id: message.id,
        sessionId: message.sessionId
      })),
      nextCursor: undefined
    })
    vi.mocked(agentSessionService.getById).mockImplementation((id) => {
      if (id === 'session-missing') throw DataApiErrorFactory.notFound('AgentSession', id)
      return readableSession as never
    })

    const collection = collectChatRecords({ fromMs: 1_000, toMs: 2_000 })
    const candidates = await collectCandidates(collection)

    expect(candidates.map((candidate) => candidate.id)).toEqual([
      'agent-session-message:agent-message-readable-session'
    ])
    expect(collection.warnings).toEqual(new Set(['source_changed']))
  })

  it('rechecks actual bytes and omits a changed candidate that exceeds the staging budget', async () => {
    vi.mocked(messageService.listLiveCreatedInRangeMetadataPage).mockReturnValue({
      items: [{ ...normalMessageMetadata[0], entityJsonBytes: 1 }],
      nextCursor: undefined
    })
    vi.mocked(agentSessionMessageService.listCreatedInRangeMetadataPage).mockReturnValue({
      items: [],
      nextCursor: undefined
    })

    const candidates = await collectCandidates(collectChatRecords({ fromMs: 1_000, toMs: 2_000 }))
    vi.mocked(topicService.getById).mockClear()
    vi.mocked(topicService.getById).mockImplementation(() => {
      throw new Error('oversize message must be rejected before context hydration')
    })
    const projectedBytes = candidates[0].contextRecord.bytes + candidates[0].messageRecord.bytes
    const result = await stageChatRecords(candidates, tempRoot, projectedBytes)
    const actualMessageBytes = Buffer.byteLength(`${JSON.stringify(normalMessages[0])}\n`, 'utf8')

    expect(result.sources).toEqual([])
    expect(result.included).toEqual({ bytes: 0, messageCount: 0, recordCount: 0 })
    expect(result.observedByteDelta).toBe(actualMessageBytes - candidates[0].messageRecord.bytes)
    expect(result.warnings).toEqual(new Set(['size_limit_reached', 'source_changed']))
    expect(topicService.getById).not.toHaveBeenCalled()
  })

  it('includes a shared context when an earlier candidate was skipped after hydration', async () => {
    const changedNewMessage = {
      ...normalMessages[0],
      data: { parts: [{ type: 'text', text: 'x'.repeat(1024) }] }
    }
    vi.mocked(messageService.getById).mockImplementation(
      (id) => (id === changedNewMessage.id ? changedNewMessage : normalMessages[1]) as never
    )
    vi.mocked(agentSessionMessageService.listCreatedInRangeMetadataPage).mockReturnValue({
      items: [],
      nextCursor: undefined
    })

    const candidates = await collectCandidates(collectChatRecords({ fromMs: 1_000, toMs: 2_000 }))
    const expectedMessageLine = `${JSON.stringify(normalMessages[1])}\n`
    const expectedTopicLine = `${JSON.stringify(normalTopic)}\n`
    const result = await stageChatRecords(
      candidates,
      tempRoot,
      Buffer.byteLength(expectedMessageLine + expectedTopicLine, 'utf8')
    )

    expect(await readFile(path.join(tempRoot, 'chats/messages.jsonl'), 'utf8')).toBe(expectedMessageLine)
    expect(await readFile(path.join(tempRoot, 'chats/topics.jsonl'), 'utf8')).toBe(expectedTopicLine)
    expect(result.included).toEqual({
      bytes: Buffer.byteLength(expectedMessageLine + expectedTopicLine, 'utf8'),
      messageCount: 1,
      recordCount: 2
    })
    expect(result.warnings).toEqual(new Set(['size_limit_reached', 'source_changed']))
  })
})
