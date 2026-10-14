import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { application } from '@application'
import { assistantTable } from '@data/db/schemas/assistant'
import { messageTable } from '@data/db/schemas/message'
import { topicTable } from '@data/db/schemas/topic'
import { apiGatewayPairedDeviceService } from '@data/services/ApiGatewayPairedDeviceService'
import { messageService } from '@data/services/MessageService'
import { remoteCommandService } from '@data/services/RemoteCommandService'
import { topicService } from '@data/services/TopicService'
import { DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'

import { sha256, utf8 } from '../agentQueries'
import {
  assertView,
  getAssistantTopic,
  listAssistants,
  listAssistantMessages,
  listAssistantParts,
  persistedAssistantInteractions,
  readAssistantContent
} from '../assistantQueries'

describe('Assistant remote branch and durable admission', () => {
  const dbh = setupTestDatabase()
  function seed() {
    dbh.db
      .insert(assistantTable)
      .values({
        id: 'assistant',
        name: 'Desktop assistant',
        emoji: '🍒',
        settings: DEFAULT_ASSISTANT_SETTINGS,
        orderKey: 'a0'
      })
      .run()
    const topic = topicService.create({ assistantId: 'assistant', name: 'Topic' })
    const user = messageService.create(topic.id, {
      role: 'user',
      data: { parts: [{ type: 'text', text: 'Question' }] },
      status: 'success'
    })
    const answer = messageService.create(topic.id, {
      role: 'assistant',
      parentId: user.id,
      data: { parts: [{ type: 'text', text: 'Answer' }] },
      status: 'success'
    })
    return { topic, user, answer }
  }

  it.each([3, 20, 100])('bounds long Assistant catalogs by bytes without skipping unsent rows at limit %s', (limit) => {
    const ids = Array.from({ length: 24 }, (_, index) => `assistant-${String(index).padStart(2, '0')}`)
    dbh.db
      .insert(assistantTable)
      .values(
        ids.map((id) => ({
          id,
          name: '长'.repeat(4096),
          emoji: '🍒',
          settings: DEFAULT_ASSISTANT_SETTINGS,
          orderKey: id,
          updatedAt: 1000
        }))
      )
      .run()
    const read: string[] = []
    const legacyCursor = `1.${sha256(utf8(`assistants:grant:${limit}:1`))}`
    expect(() => listAssistants('grant', legacyCursor, limit)).toThrow('another grant')
    let cursor: string | null = null
    do {
      const page = listAssistants('grant', cursor ?? undefined, limit)
      expect(page.items.length).toBeGreaterThan(0)
      expect(page.items.length).toBeLessThanOrEqual(limit)
      expect(Buffer.byteLength(JSON.stringify({ jsonrpc: '2.0', id: 'catalog', result: page }))).toBeLessThan(65_536)
      read.push(...page.items.map((item) => item.assistantId))
      if (page.nextCursor) {
        expect(Number(page.nextCursor.split('.')[0])).toBe(read.length)
        expect(() => listAssistants('other-grant', page.nextCursor!, limit)).toThrow('another grant')
      }
      expect(read.length).toBeLessThanOrEqual(ids.length)
      cursor = page.nextCursor
    } while (cursor)
    expect(read).toEqual(ids)
    expect(new Set(read).size).toBe(ids.length)
  })

  it('reads only the selected branch and invalidates cursors for grants, edits and branch switches', () => {
    const { topic, user, answer } = seed()
    const sibling = messageService.create(topic.id, {
      role: 'assistant',
      parentId: user.id,
      setAsActive: false,
      data: { parts: [{ type: 'text', text: 'Other branch' }] },
      status: 'success'
    })
    const view = getAssistantTopic(topic.id)
    const page = listAssistantMessages({ ...view, limit: 1 }, 'grant')
    expect(page.items.map((item) => item.messageId)).toEqual([answer.id])
    expect(page.nextCursor).not.toBeNull()
    expect(() => listAssistantMessages({ ...view, cursor: page.nextCursor! }, 'another-grant')).toThrow(
      'revision or grant'
    )
    expect(() =>
      listAssistantParts({ ...view, messageId: sibling.id, messageRevision: view.historyRevision }, 'grant')
    ).toThrow('not on the current topic branch')
    messageService.update(answer.id, { data: { parts: [{ type: 'text', text: 'Edited answer' }] } })
    expect(() => assertView(view)).toThrow('branch changed')
    topicService.setActiveNode(topic.id, sibling.id)
    const changed = getAssistantTopic(topic.id)
    expect(listAssistantMessages(changed, 'grant').items.map((item) => item.messageId)).toEqual([user.id, sibling.id])
  })

  it('advances history revisions even when two visible writes share the same timestamp', () => {
    const { topic, answer } = seed()
    const first = getAssistantTopic(topic.id).historyRevision
    dbh.db
      .update(messageTable)
      .set({ data: { parts: [{ type: 'text', text: 'First edit' }] }, updatedAt: 100 })
      .where(eq(messageTable.id, answer.id))
      .run()
    const second = getAssistantTopic(topic.id).historyRevision
    dbh.db
      .update(messageTable)
      .set({ data: { parts: [{ type: 'text', text: 'Second edit' }] }, updatedAt: 100 })
      .where(eq(messageTable.id, answer.id))
      .run()
    const third = getAssistantTopic(topic.id).historyRevision
    expect(BigInt(second)).toBeGreaterThan(BigInt(first))
    expect(BigInt(third)).toBeGreaterThan(BigInt(second))
  })

  it('includes a selected multi-model reply group without exposing unrelated sibling branches', () => {
    const { topic, user, answer } = seed()
    messageService.update(answer.id, { siblingsGroupId: 1 })
    const modelReply = messageService.create(topic.id, {
      role: 'assistant',
      parentId: user.id,
      siblingsGroupId: 1,
      setAsActive: false,
      status: 'success',
      data: { parts: [{ type: 'text', text: 'Parallel model answer' }] }
    })
    const otherBranch = messageService.create(topic.id, {
      role: 'assistant',
      parentId: user.id,
      setAsActive: false,
      status: 'success',
      data: { parts: [{ type: 'text', text: 'Unselected branch' }] }
    })
    const view = getAssistantTopic(topic.id)
    const page = listAssistantMessages(view, 'grant')
    expect(page.items.map((item) => item.messageId)).toEqual(
      expect.arrayContaining([user.id, answer.id, modelReply.id])
    )
    expect(page.items.some((item) => item.messageId === otherBranch.id)).toBe(false)
    expect(
      listAssistantParts({ ...view, messageId: modelReply.id, messageRevision: view.historyRevision }, 'grant').items[0]
    ).toMatchObject({ kind: 'text', content: { text: 'Parallel model answer' } })
  })

  it('returns bounded content references and binds pending approval to its input and view revision', () => {
    const { topic, answer } = seed()
    const text = '你好'.repeat(5000)
    messageService.update(answer.id, {
      data: {
        parts: [
          { type: 'text', text },
          {
            type: 'dynamic-tool',
            toolName: 'mcp_write',
            toolCallId: 'tool-call',
            state: 'approval-requested',
            input: { path: 'example.txt' },
            approval: { id: 'approval' }
          }
        ]
      }
    })
    const view = getAssistantTopic(topic.id)
    const parts = listAssistantParts({ ...view, messageId: answer.id, messageRevision: view.historyRevision }, 'grant')
    const first = parts.items[0]
    expect(first).toMatchObject({ kind: 'text', content: { ref: { byteLength: String(Buffer.byteLength(text)) } } })
    const content = readAssistantContent({
      ...view,
      contentId: first.partId,
      revision: view.historyRevision,
      offset: '0',
      maxBytes: 1024
    })
    expect(new TextDecoder().decode(content)).toBe(text)
    const interaction = persistedAssistantInteractions(topic.id)[0]
    expect(interaction).toMatchObject({
      messageId: answer.id,
      status: 'pending',
      respondable: true,
      desktopRequired: false,
      revision: view.historyRevision
    })
    messageService.update(answer.id, { data: { parts: [{ type: 'text', text: 'Changed' }] } })
    expect(() =>
      readAssistantContent({
        ...view,
        contentId: first.partId,
        revision: view.historyRevision,
        offset: '0',
        maxBytes: 1024
      })
    ).toThrow('branch changed')
  })

  it('commits topic creation with its receipt and rolls back both when creation fails', () => {
    seed()
    const { authorization, device } = apiGatewayPairedDeviceService.approveRemote({
      name: 'Phone',
      platform: 'ios',
      peerIdentity: 'phone',
      capabilities: ['assistant']
    })
    const key = { deviceId: device.id, grantId: authorization.grants[0].grantId, commandId: 'create-topic' }
    const input = { method: 'assistant.topics.create', identityDigest: 'a'.repeat(64) }
    const created = remoteCommandService.apply(key, input, (tx) => {
      const topic = topicService.createTx(tx, { assistantId: 'assistant' })
      return { status: 'applied', topicId: topic.id }
    })
    expect(created.kind).toBe('accepted')
    const replay = remoteCommandService.apply(key, input, () => {
      throw new Error('Must not execute a retry')
    })
    expect(replay).toMatchObject({ kind: 'existing', receipt: { status: 'applied', topicId: expect.any(String) } })
    const failing = { ...key, commandId: 'failed-topic' }
    const before = dbh.db.select().from(topicTable).all().length
    expect(() =>
      remoteCommandService.apply(failing, input, (tx) => {
        topicService.createTx(tx, { assistantId: 'assistant' })
        throw new Error('Reservation failed')
      })
    ).toThrow('Reservation failed')
    expect(remoteCommandService.get(failing)).toBeUndefined()
    expect(dbh.db.select().from(topicTable).all()).toHaveLength(before)
  })

  it('rolls back a user turn when its durable execution association cannot commit', () => {
    const { topic, answer } = seed()
    const before = getAssistantTopic(topic.id)
    expect(() =>
      messageService.createUserMessageWithPlaceholders(
        {
          topicId: topic.id,
          userMessage: {
            mode: 'create',
            dto: { role: 'user', parentId: answer.id, data: { parts: [{ type: 'text', text: 'New turn' }] } }
          },
          placeholders: [{ role: 'assistant', data: { parts: [] }, status: 'pending' }]
        },
        {
          onPersist: () => {
            throw new Error('Receipt could not be associated')
          }
        }
      )
    ).toThrow('Receipt could not be associated')
    expect(getAssistantTopic(topic.id)).toEqual(before)
    expect(
      application.get('DbService').getDb().select().from(messageTable).where(eq(messageTable.topicId, topic.id)).all()
    ).toHaveLength(3)
  })
})
