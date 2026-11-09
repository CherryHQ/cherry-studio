import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { agentSessionMessageService as messages } from '@data/services/AgentSessionMessageService'
import type { CherryMessagePart } from '@shared/data/types/message'

import { recoverSessionDeliveries } from '../recoverSessionDeliveries'

const ASSISTANT_ID = '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d002'

describe('recoverSessionDeliveries', () => {
  const dbh = setupTestDatabase()

  beforeEach(() => {
    dbh.db.insert(agentTable).values({ id: 'agent', type: 'pi', name: 'Agent', instructions: '', orderKey: 'a0' }).run()
    dbh.db
      .insert(agentWorkspaceTable)
      .values({ id: 'workspace', name: 'Workspace', path: '/tmp/delivery-recovery', type: 'user', orderKey: 'a0' })
      .run()
    for (const id of ['sender', 'target']) {
      dbh.db
        .insert(agentSessionTable)
        .values({ id, agentId: 'agent', workspaceId: 'workspace', name: id, orderKey: id })
        .run()
    }
  })

  function startDelivery(parts: CherryMessagePart[] = []) {
    const request = messages.acceptSessionDelivery({
      senderAgentId: 'agent',
      senderSessionId: 'sender',
      receiverSessionId: 'target',
      content: 'Do the work',
      replyPolicy: 'completion'
    })
    messages.saveMessage({
      sessionId: 'target',
      message: { id: ASSISTANT_ID, role: 'assistant', status: 'pending', data: { parts } }
    })
    messages.transitionSessionDelivery('target', request.id, 'delivering', {
      expected: ['accepted'],
      turnRef: ASSISTANT_ID
    })
    return request
  }

  it('preserves a private checkpoint and delivers the interrupted text exactly once after restart', () => {
    const request = startDelivery()
    messages.saveStreamCheckpoint(ASSISTANT_ID, [{ type: 'text', text: 'Saved partial reply', state: 'streaming' }])
    expect(messages.getSessionMessage('target', ASSISTANT_ID).data).toEqual({ parts: [] })
    expect(messages.findCrashOrphanedAssistantMessages(['pi'])).toEqual([])

    recoverSessionDeliveries()

    const recovered = messages.getSessionMessage('target', ASSISTANT_ID)
    expect(recovered.status).toBe('error')
    expect(recovered.data.parts).toEqual([
      { type: 'text', text: 'Saved partial reply', state: 'done' },
      expect.objectContaining({ type: 'data-error', data: expect.objectContaining({ name: 'ReplyInterruptedError' }) })
    ])
    expect(
      dbh.db.select().from(agentSessionMessageTable).where(eq(agentSessionMessageTable.id, ASSISTANT_ID)).get()!.data
    ).not.toHaveProperty('streamCheckpoint')
    expect(messages.getSessionMessage('target', request.id).delivery).toMatchObject({
      status: 'consumed',
      outcome: 'interrupted'
    })
    const results = messages.listSessionMessages('sender').items
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({
      data: { parts: [{ type: 'text', text: 'Saved partial reply' }] },
      delivery: { inReplyTo: request.id, outcome: 'interrupted' }
    })

    recoverSessionDeliveries()
    expect(messages.getSessionMessage('target', ASSISTANT_ID)).toEqual(recovered)
    expect(messages.listSessionMessages('sender').items).toEqual(results)
  })

  it('does not replace a completed reply or label its delivery interrupted', () => {
    const request = startDelivery()
    messages.saveStreamCheckpoint(ASSISTANT_ID, [{ type: 'text', text: 'Partial' }])
    messages.saveMessage({
      sessionId: 'target',
      message: {
        id: ASSISTANT_ID,
        role: 'assistant',
        status: 'success',
        data: { parts: [{ type: 'text', text: 'Completed reply' }] }
      }
    })
    const completed = messages.getSessionMessage('target', ASSISTANT_ID)

    recoverSessionDeliveries()

    expect(messages.getSessionMessage('target', ASSISTANT_ID)).toEqual(completed)
    expect(messages.getSessionMessage('target', request.id).delivery).toMatchObject({
      status: 'consumed',
      outcome: 'success'
    })
    expect(messages.listSessionMessages('sender').items).toMatchObject([
      { data: { parts: [{ type: 'text', text: 'Completed reply' }] }, delivery: { outcome: 'success' } }
    ])
  })

  it('falls back to existing parts when no checkpoint was saved', () => {
    startDelivery([{ type: 'text', text: 'Existing reply', state: 'streaming' }])
    recoverSessionDeliveries()
    expect(messages.getSessionMessage('target', ASSISTANT_ID)).toMatchObject({
      status: 'error',
      data: {
        parts: [
          { type: 'text', text: 'Existing reply', state: 'done' },
          expect.objectContaining({ type: 'data-error' })
        ]
      }
    })
  })
})
