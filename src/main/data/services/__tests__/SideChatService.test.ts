import { setupTestDatabase } from '@test-helpers/db'
import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { messageTable } from '@data/db/schemas/message'
import { agentSessionService } from '@data/services/AgentSessionService'
import { messageService } from '@data/services/MessageService'
import { sideChatService } from '@data/services/SideChatService'
import { topicService } from '@data/services/TopicService'
import { createUniqueModelId } from '@shared/data/types/model'

const config = { modelId: createUniqueModelId('provider', 'model'), prompt: 'Explain briefly.' }

function source() {
  const topic = topicService.create({ name: 'Main' })
  const user = messageService.create(topic.id, {
    role: 'user',
    data: { parts: [{ type: 'text', text: 'Original question' }] },
    status: 'success',
    setAsActive: true
  })
  const answer = messageService.create(topic.id, {
    role: 'assistant',
    parentId: user.id,
    data: { parts: [{ type: 'text', text: 'An original answer' }] },
    status: 'success',
    setAsActive: true
  })
  return { topicId: topic.id, messageId: answer.id, selection: 'original' }
}

describe('saved side-chat source and lifecycle', () => {
  const dbh = setupTestDatabase()

  function agentSource() {
    dbh.db
      .insert(agentWorkspaceTable)
      .values({ id: 'workspace', name: 'Workspace', path: '/test', type: 'user', orderKey: 'a0' })
      .run()
    dbh.db
      .insert(agentSessionTable)
      .values({ id: 'session', name: 'Session', workspaceId: 'workspace', orderKey: 'a0' })
      .run()
    dbh.db
      .insert(agentSessionMessageTable)
      .values([
        {
          id: 'question',
          sessionId: 'session',
          role: 'user',
          data: { parts: [{ type: 'text', text: 'Branch question' }] },
          status: 'success'
        },
        {
          id: 'answer',
          sessionId: 'session',
          parentId: 'question',
          role: 'assistant',
          data: {
            parts: [
              { type: 'text', text: 'Branch answer' },
              { type: 'reasoning', text: 'Private reasoning' }
            ]
          },
          status: 'success'
        },
        {
          id: 'sibling',
          sessionId: 'session',
          role: 'user',
          data: { parts: [{ type: 'text', text: 'Unrelated branch' }] },
          status: 'success'
        }
      ])
      .run()
    return { topicId: 'agent-session:session', messageId: 'answer', selection: 'answer' }
  }

  it('captures the Agent answer ancestry without sibling, reasoning or foreign-session content', () => {
    const input = agentSource()
    const side = sideChatService.create(input, config)
    expect(side.metadata.snapshot).toMatchObject({
      answer: 'Branch answer',
      question: 'Branch question',
      selection: 'answer'
    })
    expect(sideChatService.list(input.topicId).map((item) => item.topicId)).toEqual([side.topicId])
    dbh.db
      .insert(agentSessionTable)
      .values({ id: 'other', name: 'Other', workspaceId: 'workspace', orderKey: 'a1' })
      .run()
    expect(() => sideChatService.create({ ...input, topicId: 'agent-session:other' }, config)).toThrow()
    dbh.db.update(agentSessionTable).set({ type: 'background' }).where(eq(agentSessionTable.id, 'session')).run()
    expect(() => sideChatService.get(side.topicId)).toThrow()
  })

  it('hides and restores Agent side chats and purges their root data with the source', () => {
    const input = agentSource()
    const side = sideChatService.create(input, config)
    agentSessionService.delete('session')
    expect(() => sideChatService.get(side.topicId)).toThrow()
    agentSessionService.restore('session')
    expect(sideChatService.get(side.topicId).metadata.snapshot.question).toBe('Branch question')
    agentSessionService.delete('session')
    agentSessionService.delete('session', { permanent: true })
    expect(sideChatService.find(side.topicId)).toBeUndefined()
    expect(() => topicService.getById(side.topicId)).toThrow()
  })

  it('keeps structural metadata outside history and preserves it when messages are cleared', () => {
    const input = source()
    const side = sideChatService.create(input, config)
    const root = dbh.db
      .select()
      .from(messageTable)
      .where(and(eq(messageTable.topicId, side.topicId), eq(messageTable.role, 'root')))
      .get()!
    expect(root.data).toEqual({ parts: [], sideChat: { ...side.metadata, sourceTopicId: input.topicId, version: 1 } })
    expect(root.searchableText).toBe('')
    expect(() => messageService.update(root.id, { data: { parts: [] } })).toThrow()
    const question = messageService.create(side.topicId, {
      role: 'user',
      data: { parts: [{ type: 'text', text: 'Side question' }] },
      status: 'success',
      setAsActive: true
    })
    expect(messageService.getPathToNode(question.id).map((message) => message.id)).toEqual([question.id])
    messageService.clearTopicMessages(side.topicId)
    expect(sideChatService.get(side.topicId)).toEqual(side)
    const copied = topicService.duplicate(input.topicId, { nodeId: input.messageId })
    expect(sideChatService.find(copied.id)).toBeUndefined()
  })

  it('counts submitted questions, including failures, independently of assistant replies', () => {
    const input = source()
    const side = sideChatService.create(input, config)
    const first = messageService.create(side.topicId, {
      role: 'user',
      data: { parts: [{ type: 'text', text: 'First question' }] },
      status: 'success',
      setAsActive: true
    })
    messageService.create(side.topicId, {
      role: 'assistant',
      data: { parts: [] },
      status: 'error',
      setAsActive: true
    })
    messageService.create(side.topicId, {
      role: 'user',
      data: { parts: [{ type: 'text', text: 'Second question' }] },
      status: 'success',
      setAsActive: true
    })
    expect(sideChatService.get(side.topicId).questionCount).toBe(2)
    messageService.delete(first.id)
    expect(sideChatService.get(side.topicId).questionCount).toBe(1)
  })

  it('captures only the source path and retains the snapshot after source deletion', () => {
    const input = source()
    const side = sideChatService.create(input, config)
    messageService.create(input.topicId, {
      role: 'user',
      data: { parts: [{ type: 'text', text: 'Later question' }] },
      status: 'success',
      setAsActive: true
    })
    messageService.delete(input.messageId)
    expect(sideChatService.get(side.topicId).metadata.snapshot).toEqual({
      messageId: input.messageId,
      selection: 'original',
      answer: 'An original answer',
      question: 'Original question',
      prefix: 'An ',
      suffix: ' answer'
    })
    expect(sideChatService.list(input.topicId).map((row) => row.topicId)).toEqual([side.topicId])
  })

  it('rejects mismatched sources, nested side chats, and text absent from the answer', () => {
    const input = source()
    const other = topicService.create({ name: 'Other' })
    expect(() => sideChatService.create({ ...input, topicId: other.id }, config)).toThrow()
    expect(() => sideChatService.create({ ...input, selection: 'forged text' }, config)).toThrow()
    const side = sideChatService.create(input, config)
    expect(() => sideChatService.create({ ...input, topicId: side.topicId }, config)).toThrow()
    expect(
      topicService
        .listByCursor()
        .items.map((topic) => topic.id)
        .sort()
    ).toEqual([input.topicId, other.id].sort())
  })

  it('isolates configuration and hides side chats from ordinary topic reads', () => {
    const input = source()
    const side = sideChatService.create(input, config)
    sideChatService.updateConfig(side.topicId, { ...config, prompt: 'Changed' })
    expect(sideChatService.get(side.topicId).metadata.config.prompt).toBe('Changed')
    expect(topicService.getById(input.topicId).assistantId).toBeUndefined()
    expect(topicService.listByCursor().items.map((topic) => topic.id)).toEqual([input.topicId])
    expect(topicService.getLatestActive({})?.id).toBe(input.topicId)
    expect(topicService.reuseOrCreatePlaceholder({}).topic.id).not.toBe(side.topicId)
  })

  it('hides, restores, and permanently deletes associated topics with the source', () => {
    const input = source()
    const side = sideChatService.create(input, config)
    expect(topicService.deleteByIds([input.topicId, side.topicId, input.topicId]).deletedCount).toBe(2)
    expect(() => sideChatService.get(side.topicId)).toThrow()
    topicService.restore(input.topicId)
    expect(sideChatService.get(side.topicId).metadata.snapshot.selection).toBe('original')
    topicService.delete(input.topicId)
    topicService.delete(input.topicId, { permanent: true })
    expect(sideChatService.find(side.topicId)).toBeUndefined()
    expect(() => topicService.getById(side.topicId)).toThrow()
  })
})
