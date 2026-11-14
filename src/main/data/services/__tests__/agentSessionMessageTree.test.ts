import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable as sessions } from '@data/db/schemas/agentSession'
import { agentSessionMessageTable as messages } from '@data/db/schemas/agentSessionMessage'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { AgentSessionMessageTreeSeeder } from '@data/db/seeding/seeders/AgentSessionMessageTreeSeeder'
import { agentSessionMessageService as service } from '@data/services/AgentSessionMessageService'

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

  it('projects large outputs as each page is read without hydrating the lookahead message', () => {
    const output = { content: 'x'.repeat(128 * 1024) }
    let parentId = service.captureHead(sessionId)
    dbh.db.transaction((tx) => {
      for (let i = 0; i < 52; i++) {
        const id = `page-${i}`
        tx.insert(messages)
          .values({
            id,
            sessionId,
            parentId,
            role: 'assistant',
            status: 'success',
            createdAt: i + 100,
            updatedAt: i + 100,
            data: {
              parts: [
                {
                  type: 'dynamic-tool',
                  toolName: 'probe',
                  toolCallId: `call-${i}`,
                  state: 'output-available',
                  input: {},
                  output
                }
              ]
            }
          })
          .run()
        parentId = id
      }
      tx.update(sessions).set({ activeNodeId: parentId }).where(eq(sessions.id, sessionId)).run()
    })
    const decode = messages.data.mapFromDriverValue.bind(messages.data)
    const guard = vi.spyOn(messages.data, 'mapFromDriverValue').mockImplementation((raw) => {
      if (typeof raw === 'string' && raw.includes('"call-1"')) throw new Error('Lookahead payload must not be hydrated')
      return decode(raw)
    })
    let page: ReturnType<typeof service.listSessionMessages>
    try {
      page = service.listSessionMessages(sessionId, { deferToolOutputs: true })
    } finally {
      guard.mockRestore()
    }
    expect(page.items).toHaveLength(50)
    expect(page.items.map((item) => item.id)).toEqual(Array.from({ length: 50 }, (_, i) => `page-${51 - i}`))
    expect(page.items[0].data.parts![0]).toMatchObject({
      output: {
        $deferredToolResult: { topicId: `agent-session:${sessionId}`, messageId: 'page-51', toolCallId: 'call-51' }
      }
    })
    const older = service.listSessionMessages(sessionId, { cursor: page.nextCursor, deferToolOutputs: true })
    expect(older.items.map((item) => item.id)).toEqual(['page-1', 'page-0'])
    expect(older.nextCursor).toBeUndefined()
    const raw = service.listSessionMessages(sessionId, { limit: 1 })
    expect(raw.items[0].data.parts![0]).toMatchObject({ output })
    expect(service.getSessionMessage(sessionId, 'page-51').data.parts![0]).toMatchObject({ output })
  })

  it('keeps small tool outputs and user parts verbatim when deferral is requested', () => {
    const data = {
      parts: [
        {
          type: 'dynamic-tool' as const,
          toolName: 'probe',
          toolCallId: 'small',
          state: 'output-available' as const,
          input: {},
          output: { value: 1 }
        }
      ]
    }
    service.saveMessage({ sessionId, message: { role: 'assistant', data } })
    const user = service.saveMessage({
      sessionId,
      message: { role: 'user', data: { parts: [{ type: 'text', text: 'user text' }] } }
    })
    const page = service.listSessionMessages(sessionId, { deferToolOutputs: true })
    expect(page.items[0].data).toEqual(user.data)
    expect(page.items[1].data.parts).toEqual(data.parts)
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

  it('replaces the edited subtree without retaining another version or deleting an existing sibling', () => {
    const prefix = append('Shared prefix')
    const original = append('Original question')
    const answer = append('Original answer')
    const later = append('Later question')
    const sibling = append('Existing sibling', prefix.id)
    service.selectBranch(sessionId, original.id)
    const target = {
      messageId: original.id,
      version: service.readEditSnapshotTx(dbh.db, sessionId, original.id).version
    }
    const replacement = dbh.db.transaction((tx) => {
      service.replaceEditBranchTx(tx, sessionId, target)
      return service.saveMessagesTx(tx, {
        sessionId,
        messages: [{ role: 'user', status: 'success', data: { parts: [{ type: 'text', text: 'Replacement' }] } }]
      })[0]
    })
    expect(visibleIds()).toEqual([prefix.id, replacement.id])
    for (const removed of [original, answer, later])
      expect(() => service.getSessionMessage(sessionId, removed.id)).toThrow()
    expect(service.listSessionMessages(sessionId).items[0].siblings).toEqual([sibling.id, replacement.id])
    service.selectBranch(sessionId, sibling.id)
    expect(visibleIds()).toEqual([prefix.id, sibling.id])
  })

  it('rejects an edit while an outgoing delivery still needs its original reply anchor', () => {
    dbh.db.insert(agentTable).values({ id: 'agent', type: 'pi', name: 'Agent', instructions: '', orderKey: 'a0' }).run()
    dbh.db.update(sessions).set({ agentId: 'agent' }).where(eq(sessions.id, sessionId)).run()
    dbh.db
      .insert(sessions)
      .values({ id: 'receiver', agentId: 'agent', name: 'Receiver', workspaceId: 'work', orderKey: 'a1' })
      .run()
    const original = append('Original input')
    const request = service.acceptSessionDelivery({
      senderAgentId: 'agent',
      senderSessionId: sessionId,
      senderMessageId: original.id,
      receiverSessionId: 'receiver',
      content: 'Work',
      replyPolicy: 'completion'
    })
    expect(() => service.readEditSnapshotTx(dbh.db, sessionId, original.id)).toThrow(
      expect.objectContaining({ reason: 'busy' })
    )
    expect(visibleIds()).toEqual([original.id])
    service.transitionSessionDelivery('receiver', request.id, 'consumed', { expected: ['accepted'] })
    expect(service.readEditSnapshotTx(dbh.db, sessionId, original.id).user.id).toBe(original.id)
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
    expect(() =>
      service.updateSessionMessage('receiver', request.id, {
        data: { parts: [{ type: 'text', text: 'Work updated' }] }
      })
    ).toThrow(expect.objectContaining({ code: 'RESOURCE_LOCKED' }))
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

  it('selects the newest immediate child at each fork, rather than the newest leaf in the subtree', () => {
    const rootId = service.captureHead(sessionId)
    dbh.db
      .insert(messages)
      .values([
        {
          id: 'older',
          sessionId,
          parentId: rootId,
          role: 'user',
          status: 'success',
          data: { parts: [] },
          createdAt: 1
        },
        {
          id: 'newer-a',
          sessionId,
          parentId: rootId,
          role: 'user',
          status: 'success',
          data: { parts: [] },
          createdAt: 2
        },
        {
          id: 'newer-b',
          sessionId,
          parentId: rootId,
          role: 'user',
          status: 'success',
          data: { parts: [] },
          createdAt: 2
        },
        {
          id: 'old-branch-late-reply',
          sessionId,
          parentId: 'older',
          role: 'assistant',
          status: 'success',
          data: { parts: [] },
          createdAt: 100
        },
        {
          id: 'chosen-reply',
          sessionId,
          parentId: 'newer-b',
          role: 'assistant',
          status: 'success',
          data: { parts: [] },
          createdAt: 3
        }
      ])
      .run()
    expect(service.branchTip(sessionId, rootId)).toBe('chosen-reply')
    expect(service.branchTip(sessionId, 'older')).toBe('old-branch-late-reply')
    expect(service.branchTip(sessionId, 'newer-a')).toBe('newer-a')
    service.selectBranch(sessionId, rootId)
    expect(visibleIds()).toEqual(['newer-b', 'chosen-reply'])
    expect(service.listSessionMessages(sessionId).items.find((row) => row.id === 'newer-b')?.siblings).toEqual([
      'older',
      'newer-a',
      'newer-b'
    ])
  })

  it('seeds empty sessions without resetting their timestamps or an existing branch selection', () => {
    dbh.db.update(sessions).set({ updatedAt: 123 }).where(eq(sessions.id, sessionId)).run()
    new AgentSessionMessageTreeSeeder().run(dbh.db)
    const session = dbh.db.select().from(sessions).where(eq(sessions.id, sessionId)).get()!
    expect(session.updatedAt).toBe(123)
    expect(dbh.db.select().from(messages).where(eq(messages.id, session.activeNodeId!)).get()?.role).toBe('root')
    expect(visibleIds()).toEqual([])
    new AgentSessionMessageTreeSeeder().run(dbh.db)
    expect(dbh.db.select().from(sessions).where(eq(sessions.id, sessionId)).get()).toEqual(session)
  })
})
