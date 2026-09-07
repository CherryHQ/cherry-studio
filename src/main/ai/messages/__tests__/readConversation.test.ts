import { agentTable } from '@data/db/schemas/agent'
import { fileEntryTable } from '@data/db/schemas/file'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { agentWorkspaceService } from '@data/services/AgentWorkspaceService'
import { messageService } from '@data/services/MessageService'
import { temporaryChatService } from '@data/services/TemporaryChatService'
import { topicService } from '@data/services/TopicService'
import { setupTestDatabase } from '@test-helpers/db'
import { MockMainFileManagerExport } from '@test-mocks/main/FileManager'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { findPersistedToolOutput, readConversation } from '../readConversation'

const fileManager = MockMainFileManagerExport.fileManager as unknown as {
  read: ReturnType<typeof vi.fn>
}

function persistedToolData(fileEntryId: string) {
  return {
    parts: [
      {
        type: 'tool-run_cmd',
        toolCallId: 'call-1',
        state: 'output-available',
        input: {},
        output: {
          $persistedToolOutput: {
            fileEntryId,
            vfsFilename: 'vfs_0123456789abcdef.txt',
            head: 'head excerpt',
            tail: 'tail excerpt',
            totalChars: 200_000,
            totalLines: 5_000,
            shape: 'text'
          }
        }
      }
    ]
  } as never
}

type TopicReadResult = Extract<ReturnType<typeof readConversation>, { source: 'topic' }>

function topicOf(result: ReturnType<typeof readConversation>): TopicReadResult {
  if (result.source !== 'topic' || !('messages' in result)) throw new Error('Expected a topic conversation')
  return result
}

describe('readConversation', () => {
  const dbh = setupTestDatabase()
  let temporaryTopicId: string | undefined

  beforeEach(() => {
    temporaryTopicId = undefined
    fileManager.read = vi.fn()
  })

  afterEach(() => {
    if (temporaryTopicId && temporaryChatService.hasTopic(temporaryTopicId))
      temporaryChatService.deleteTopic(temporaryTopicId)
  })

  it('reads the current topic branch, pagination and an exact message from SQLite', () => {
    const topic = topicService.create({ name: 'readable topic' })
    const first = messageService.create(topic.id, {
      role: 'user',
      data: { parts: [{ type: 'text', text: 'first question' }] },
      status: 'success'
    })
    const second = messageService.create(topic.id, {
      role: 'assistant',
      data: { parts: [{ type: 'text', text: 'second answer' }] },
      status: 'success',
      parentId: first.id
    })
    const alternate = messageService.create(topic.id, {
      role: 'assistant',
      data: { parts: [{ type: 'text', text: 'alternate answer' }] },
      status: 'success',
      parentId: first.id,
      setAsActive: false
    })

    const page = topicOf(readConversation({ sessionId: topic.id, limit: 1 }))
    expect(page.messages).toHaveLength(1)
    expect(page.nextCursor).toBeDefined()
    expect(page.messages[0].message.id).toBe(second.id)

    const olderPage = topicOf(readConversation({ sessionId: topic.id, cursor: page.nextCursor, limit: 1 }))
    expect(olderPage.messages.map((item) => item.message.id)).toEqual([first.id])

    const exact = readConversation({ sessionId: topic.id, messageId: first.id })
    expect(exact).toMatchObject({
      source: 'topic',
      message: { id: first.id, role: 'user', data: { parts: [{ type: 'text', text: 'first question' }] } }
    })

    const selectedBranch = topicOf(readConversation({ sessionId: topic.id, nodeId: second.id, includeSiblings: false }))
    expect(selectedBranch.messages.map((item) => item.message.id)).toEqual([first.id, second.id])
    expect(selectedBranch.messages.map((item) => item.message.id)).not.toContain(alternate.id)

    const later = messageService.create(topic.id, {
      role: 'user',
      data: { parts: [{ type: 'text', text: 'new content after the first read' }] },
      status: 'success',
      parentId: second.id
    })
    const current = topicOf(readConversation({ sessionId: topic.id, nodeId: later.id }))
    expect(current.messages.some((item) => item.message.id === later.id)).toBe(true)

    const afterAppend = topicOf(readConversation({ sessionId: topic.id }))
    expect(afterAppend.messages.some((item) => item.message.id === later.id)).toBe(true)
  })

  it('reads Agent Session messages and temporary messages by the same session_id contract', () => {
    dbh.db
      .insert(agentTable)
      .values({
        id: 'agent-read-test',
        type: 'claude-code',
        name: 'Reader',
        instructions: '',
        orderKey: 'read-agent'
      })
      .run()
    const workspace = agentWorkspaceService.findOrCreateByPath('/tmp/cherry-read-conversation')
    const session = agentSessionService.create({
      agentId: 'agent-read-test',
      name: 'Agent history',
      workspace: { type: 'user', workspaceId: workspace.id }
    })
    const [agentMessage] = agentSessionMessageService.saveMessages({
      sessionId: session.id,
      messages: [
        {
          id: crypto.randomUUID(),
          role: 'user',
          data: { parts: [{ type: 'text', text: 'agent message' }] },
          status: 'success'
        }
      ]
    })
    const agentResult = readConversation({ sessionId: session.id, messageId: agentMessage.id })
    expect(agentResult).toMatchObject({ source: 'agent', message: { id: agentMessage.id, sessionId: session.id } })

    const temporary = temporaryChatService.createTopic({ name: 'temporary' })
    temporaryTopicId = temporary.id
    const temporaryMessage = temporaryChatService.appendMessage(temporary.id, {
      role: 'user',
      data: { parts: [{ type: 'text', text: 'temporary message' }] },
      status: 'success'
    })
    const temporaryResult = readConversation({ sessionId: temporary.id })
    expect(temporaryResult).toMatchObject({
      source: 'temporary',
      messages: [{ id: temporaryMessage.id, role: 'user' }]
    })

    temporaryChatService.persist(temporary.id)
    const persistedTemporaryResult = topicOf(readConversation({ sessionId: temporary.id }))
    expect(persistedTemporaryResult.messages.some((item) => item.message.id === temporaryMessage.id)).toBe(true)

    expect(() => readConversation({ sessionId: 'temporary-that-was-never-created' })).toThrowError(
      expect.objectContaining({ code: 'NOT_FOUND' })
    )

    const deletedTemporary = temporaryChatService.createTopic({ name: 'deleted temporary' })
    temporaryChatService.deleteTopic(deletedTemporary.id)
    expect(() => readConversation({ sessionId: deletedTemporary.id })).toThrowError(
      expect.objectContaining({ code: 'NOT_FOUND' })
    )
  })

  it('rejects missing, ambiguous and source-incompatible reads', () => {
    expect(() => readConversation({ sessionId: 'missing-session' })).toThrowError(
      expect.objectContaining({ code: 'NOT_FOUND' })
    )

    const topic = topicService.create({ name: 'ambiguous topic' })
    dbh.db
      .insert(agentTable)
      .values({
        id: 'agent-ambiguous',
        type: 'claude-code',
        name: 'Ambiguous Agent',
        instructions: '',
        orderKey: 'ambiguous-agent'
      })
      .run()
    const workspace = agentWorkspaceService.findOrCreateByPath('/tmp/cherry-ambiguous-conversation')
    dbh.db.transaction((tx) => {
      agentSessionService.createTx(tx, topic.id, {
        agentId: 'agent-ambiguous',
        name: 'Ambiguous session',
        workspace: { type: 'user', workspaceId: workspace.id }
      })
    })

    expect(() => readConversation({ sessionId: topic.id })).toThrowError(expect.objectContaining({ code: 'AMBIGUOUS' }))
    const invalidTopic = topicService.create({ name: 'invalid query topic' })
    expect(() => readConversation({ sessionId: invalidTopic.id, messageId: 'missing', limit: 1 })).toThrowError(
      expect.objectContaining({ code: 'INVALID_PARAMS' })
    )
    expect(() => readConversation({ sessionId: invalidTopic.id, nodeId: 'node', messageId: 'message' })).toThrowError(
      expect.objectContaining({ code: 'INVALID_PARAMS' })
    )

    const temporary = temporaryChatService.createTopic({ name: 'invalid temporary query' })
    temporaryTopicId = temporary.id
    expect(() => readConversation({ sessionId: temporary.id, nodeId: 'node' })).toThrowError(
      expect.objectContaining({ code: 'INVALID_PARAMS' })
    )

    const otherTopic = topicService.create({ name: 'other topic' })
    const otherMessage = messageService.create(otherTopic.id, {
      role: 'user',
      data: { parts: [{ type: 'text', text: 'belongs elsewhere' }] },
      status: 'success'
    })
    expect(() => readConversation({ sessionId: invalidTopic.id, messageId: otherMessage.id })).toThrowError(
      expect.objectContaining({ code: 'NOT_FOUND' })
    )
  })

  it('restores a persisted tool result and degrades to its stored excerpt when the blob is gone', async () => {
    const topic = topicService.create({ name: 'tool output topic' })
    const fileId = '019606a0-0000-7000-8000-00000000f101'
    const now = Date.now()
    dbh.db
      .insert(fileEntryTable)
      .values({
        id: fileId,
        origin: 'internal',
        name: 'vfs_0123456789abcdef',
        ext: 'txt',
        size: 12,
        cleanupPolicy: 'delete_when_unreferenced',
        createdAt: now,
        updatedAt: now
      })
      .run()
    const message = messageService.create(topic.id, {
      role: 'assistant',
      data: persistedToolData(fileId),
      status: 'success'
    })

    fileManager.read.mockResolvedValue({ content: 'full persisted output' })
    await expect(findPersistedToolOutput(topic.id, message.id, 'call-1')).resolves.toEqual({
      found: true,
      output: 'full persisted output'
    })

    const missingBlobMessage = messageService.create(topic.id, {
      role: 'assistant',
      data: persistedToolData('019606a0-0000-7000-8000-00000000f102'),
      status: 'success'
    })
    await expect(findPersistedToolOutput(topic.id, missingBlobMessage.id, 'call-1')).resolves.toMatchObject({
      found: true,
      output: expect.stringContaining('persisted output no longer available')
    })
  })

  it('keeps the legacy agent-session topic prefix compatible with persisted tool result reads', async () => {
    dbh.db
      .insert(agentTable)
      .values({
        id: 'agent-prefixed-read',
        type: 'claude-code',
        name: 'Prefixed Reader',
        instructions: '',
        orderKey: 'prefixed-read'
      })
      .run()
    const workspace = agentWorkspaceService.findOrCreateByPath('/tmp/cherry-prefixed-read')
    const session = agentSessionService.create({
      agentId: 'agent-prefixed-read',
      name: 'Prefixed history',
      workspace: { type: 'user', workspaceId: workspace.id }
    })
    const fileId = '019606a0-0000-7000-8000-00000000f103'
    const now = Date.now()
    dbh.db
      .insert(fileEntryTable)
      .values({
        id: fileId,
        origin: 'internal',
        name: 'vfs_0123456789abcdef',
        ext: 'txt',
        size: 12,
        cleanupPolicy: 'delete_when_unreferenced',
        createdAt: now,
        updatedAt: now
      })
      .run()
    const [message] = agentSessionMessageService.saveMessages({
      sessionId: session.id,
      messages: [{ id: crypto.randomUUID(), role: 'assistant', data: persistedToolData(fileId), status: 'success' }]
    })
    fileManager.read.mockResolvedValue({ content: 'legacy full output' })

    await expect(findPersistedToolOutput(`agent-session:${session.id}`, message.id, 'call-1')).resolves.toEqual({
      found: true,
      output: 'legacy full output'
    })
  })
})
