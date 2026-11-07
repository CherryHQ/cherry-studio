import { randomUUID } from 'node:crypto'

import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable as sessions } from '@data/db/schemas/agentSession'
import { agentSessionMessageTable as messages } from '@data/db/schemas/agentSessionMessage'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { AgentSessionMessageTreeSeeder } from '@data/db/seeding/seeders/AgentSessionMessageTreeSeeder'
import { agentSessionMessageService as service } from '@data/services/AgentSessionMessageService'
import { readAgentSessionPath } from '@data/services/agentSessionMessageTree'

// Catch lost branches, orphaned descendants, and output retargeted by a later UI selection.
describe('Agent message tree', () => {
  const dbh = setupTestDatabase()
  const sessionId = 'session'

  beforeEach(() => {
    dbh.db
      .insert(agentWorkspaceTable)
      .values({ id: 'work', name: 'Work', path: '/work', type: 'user', orderKey: 'a0' })
      .run()
    dbh.db.insert(sessions).values({ id: sessionId, name: 'Archive', workspaceId: 'work', orderKey: 'a0' }).run()
  })

  function append(text: string, parentId?: string) {
    return service.saveMessage({
      sessionId,
      parentId,
      message: { role: 'user', status: 'success', data: { parts: [{ type: 'text', text }] } }
    })
  }

  function visibleIds() {
    return service
      .listSessionMessages(sessionId)
      .items.toReversed()
      .map((row) => row.id)
  }

  it('migrates flat history deterministically without changing message facts and never resets a later selection', () => {
    const ids = [randomUUID(), randomUUID()].sort()
    for (const id of ids) {
      dbh.db
        .insert(messages)
        .values({
          id,
          sessionId,
          role: 'user',
          status: 'success',
          createdAt: 100,
          updatedAt: 200,
          data: { parts: [{ type: 'text', text: id }], nativeSessionId: 'native' },
          runtimeResumeToken: 'native',
          deliveryStatus: 'accepted'
        })
        .run()
    }
    const before = dbh.db.select().from(messages).all()
    new AgentSessionMessageTreeSeeder().run(dbh.db)
    expect(visibleIds()).toEqual(ids)
    const migrated = readAgentSessionPath(dbh.db, sessionId)
    expect(migrated).toEqual(before.map((row) => ({ ...row, parentId: expect.any(String) })))
    const rootId = migrated[0].parentId!
    dbh.db.update(sessions).set({ activeNodeId: rootId }).where(eq(sessions.id, sessionId)).run()
    const alternate = append('Alternative', rootId)
    new AgentSessionMessageTreeSeeder().run(dbh.db)
    expect(visibleIds()).toEqual([alternate.id])
    expect(dbh.db.select().from(messages).where(eq(messages.id, ids[1])).get()?.deliveryStatus).toBe('accepted')
  })

  it('keeps both sibling paths and routes late output to the captured parent without changing selection', () => {
    const prefix = append('Common prefix')
    const original = append('Original')
    const oldReply = append('Old reply')
    dbh.db.update(sessions).set({ activeNodeId: prefix.id }).where(eq(sessions.id, sessionId)).run()
    const edited = append('Edited', prefix.id)
    const captured = append('New reply')
    service.selectBranch(sessionId, original.id)
    expect(visibleIds()).toEqual([prefix.id, original.id, oldReply.id])
    const late = append('Late output', captured.id)
    expect(visibleIds()).toEqual([prefix.id, original.id, oldReply.id])
    service.selectBranch(sessionId, edited.id)
    expect(visibleIds()).toEqual([prefix.id, edited.id, captured.id, late.id])
    expect(service.listSessionMessages(sessionId).items.find((row) => row.id === edited.id)?.siblings).toEqual([
      original.id,
      edited.id
    ])
  })

  it('rejects a foreign parent and keeps descendants reachable when a display message is deleted', () => {
    dbh.db.insert(sessions).values({ id: 'other', name: 'Other', workspaceId: 'work', orderKey: 'a1' }).run()
    const foreign = service.captureHead('other')
    expect(() => append('Wrong owner', foreign)).toThrow()
    const first = append('First')
    const second = append('Second')
    const third = append('Third')
    service.deleteSessionMessage(sessionId, second.id)
    expect(visibleIds()).toEqual([first.id, third.id])
    expect(() => service.deleteSessionMessage(sessionId, service.captureHead('other'))).toThrow()
  })

  it('paginates an off-branch search anchor without falling into the selected branch', () => {
    const prefix = append('Shared')
    const original = append('Original')
    const reply = append('Original reply')
    dbh.db.update(sessions).set({ activeNodeId: prefix.id }).where(eq(sessions.id, sessionId)).run()
    const alternate = append('Alternate', prefix.id)
    const first = service.listSessionMessages(sessionId, { messageId: reply.id, limit: 1 })
    const second = service.listSessionMessages(sessionId, {
      messageId: reply.id,
      limit: 1,
      cursor: first.nextCursor
    })
    const third = service.listSessionMessages(sessionId, {
      messageId: reply.id,
      limit: 1,
      cursor: second.nextCursor
    })
    expect([...first.items, ...second.items, ...third.items].map((message) => message.id)).toEqual([
      reply.id,
      original.id,
      prefix.id
    ])
    expect(visibleIds()).toEqual([prefix.id, alternate.id])
  })

  it('returns a delayed delivery to the sending branch even when the sender browses another branch', () => {
    dbh.db.insert(agentTable).values({ id: 'agent', type: 'pi', name: 'Agent', instructions: '', orderKey: 'a0' }).run()
    dbh.db.update(sessions).set({ agentId: 'agent' }).where(eq(sessions.id, sessionId)).run()
    dbh.db
      .insert(sessions)
      .values({ id: 'receiver', agentId: 'agent', name: 'Receiver', workspaceId: 'work', orderKey: 'a1' })
      .run()
    const prefix = append('Shared')
    const senderHead = append('Original branch')
    const request = service.acceptSessionDelivery({
      senderAgentId: 'agent',
      senderSessionId: sessionId,
      senderMessageId: senderHead.id,
      receiverSessionId: 'receiver',
      content: 'Work',
      replyPolicy: 'completion'
    })
    expect(request.data).not.toHaveProperty('deliveryReplyAnchor')
    service.updateSessionMessage('receiver', request.id, { data: { parts: [{ type: 'text', text: 'Work updated' }] } })
    dbh.db.update(sessions).set({ activeNodeId: prefix.id }).where(eq(sessions.id, sessionId)).run()
    const alternate = append('Alternate branch', prefix.id)
    const response = service.saveMessage({
      sessionId: 'receiver',
      message: {
        role: 'assistant',
        status: 'success',
        data: { parts: [{ type: 'text', text: 'Completed result' }] }
      }
    })
    service.transitionSessionDelivery('receiver', request.id, 'delivering', {
      expected: ['accepted'],
      turnRef: response.id
    })
    expect(() => service.deleteSessionMessage(sessionId, senderHead.id)).toThrow()
    const result = service.finalizeSessionDelivery({
      requestSessionId: 'receiver',
      requestMessageId: request.id,
      assistantMessageId: response.id,
      outcome: 'success'
    })!
    expect(visibleIds()).toEqual([prefix.id, alternate.id])
    service.selectBranch(sessionId, senderHead.id)
    expect(visibleIds()).toEqual([prefix.id, senderHead.id, result.id])
    expect(result.data.parts).toEqual([{ type: 'text', text: 'Completed result' }])
  })
})
