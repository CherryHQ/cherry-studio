import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { messageService } from '@data/services/MessageService'
import { topicService } from '@data/services/TopicService'
import type { AbsoluteFilePath } from '@shared/types/file'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { chatRecordStats, collectChatRecords, stageChatRecords } from '../chatRecordCollector'

vi.mock('@data/services/AgentSessionMessageService', () => ({
  agentSessionMessageService: { listCreatedInRange: vi.fn() }
}))
vi.mock('@data/services/AgentSessionService', () => ({
  agentSessionService: { getById: vi.fn() }
}))
vi.mock('@data/services/MessageService', () => ({
  messageService: { listLiveCreatedInRange: vi.fn() }
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

describe('chat record collection', () => {
  let tempRoot: AbsoluteFilePath

  beforeEach(async () => {
    tempRoot = (await mkdtemp(path.join(tmpdir(), 'diagnostic-chat-records-'))) as AbsoluteFilePath
    vi.mocked(messageService.listLiveCreatedInRange).mockReturnValue(normalMessages as never)
    vi.mocked(topicService.getById).mockReturnValue(normalTopic as never)
    vi.mocked(agentSessionMessageService.listCreatedInRange).mockReturnValue([agentMessage] as never)
    vi.mocked(agentSessionService.getById).mockReturnValue(agentSession as never)
  })

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true })
    vi.clearAllMocks()
  })

  it('collects and stages canonical normal-chat and agent-session entities as UTF-8 JSONL', async () => {
    const collection = collectChatRecords({ fromMs: 1_000, toMs: 2_000 })

    expect(collection.candidates).toHaveLength(3)
    expect(collection.records).toHaveLength(5)
    expect(chatRecordStats(collection.candidates)).toEqual({
      bytes: expect.any(Number),
      messageCount: 3,
      recordCount: 5
    })
    expect([...collection.records.values()].map((record) => record.archiveName)).toEqual(
      expect.arrayContaining([
        'chats/topics.jsonl',
        'chats/messages.jsonl',
        'chats/agent-sessions.jsonl',
        'chats/agent-session-messages.jsonl'
      ])
    )

    const normalMessageRecord = collection.records.get('message:message-new')!
    const normalLine = `${JSON.stringify(normalMessages[0])}\n`
    expect(normalMessageRecord.data).toEqual(Buffer.from(normalLine, 'utf8'))
    expect(normalMessageRecord.bytes).toBe(Buffer.byteLength(normalLine, 'utf8'))
    expect(JSON.parse(normalMessageRecord.data.toString('utf8'))).toEqual(normalMessages[0])

    const agentMessageRecord = collection.records.get('agent-session-message:agent-message-1')!
    expect(JSON.parse(agentMessageRecord.data.toString('utf8'))).toEqual(agentMessage)
    expect(JSON.parse(agentMessageRecord.data.toString('utf8'))).toMatchObject({
      runtimeResumeToken: 'runtime-resume-token',
      delivery: { status: 'accepted', turnRef: 'turn-1' }
    })

    const staged = await stageChatRecords(collection.candidates, tempRoot)

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

  it('keeps the readable chat family when the other family cannot be read', () => {
    vi.mocked(messageService.listLiveCreatedInRange).mockImplementation(() => {
      throw new Error('normal chat unavailable')
    })

    const collection = collectChatRecords({ fromMs: 1_000, toMs: 2_000 })

    expect(collection.warnings).toEqual(new Set(['source_unreadable']))
    expect(collection.candidates).toHaveLength(1)
    expect(collection.records.get('agent-session-message:agent-message-1')?.data.toString('utf8')).toBe(
      `${JSON.stringify(agentMessage)}\n`
    )
  })
})
