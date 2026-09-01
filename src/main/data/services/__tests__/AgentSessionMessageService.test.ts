import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { aiUsageRecordTable } from '@data/db/schemas/aiUsageRecord'
import { fileEntryTable } from '@data/db/schemas/file'
import { agentSessionMessageFileRefTable } from '@data/db/schemas/fileRelations'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { agentService } from '@data/services/AgentService'
import type { AgentSessionDeliveryRoutingError } from '@data/services/AgentSessionMessageService'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { aiUsageRecordService } from '@data/services/AiUsageRecordService'
import { createAiUsageCaptureContext } from '@main/ai/utils/usageCapture'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { notifyDataApiDataChangeMock } = vi.hoisted(() => ({
  notifyDataApiDataChangeMock: vi.fn()
}))

vi.mock('@data/dataApiDataChange', () => ({
  notifyDataApiDataChange: notifyDataApiDataChangeMock
}))

const SESSION_ID = 'session-1'
const USER_MESSAGE_ID = '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d001'
const ASSISTANT_MESSAGE_ID = '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d002'
const FILE_ENTRY_ID = '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d003'
type AgentSessionInsert = typeof agentSessionTable.$inferInsert

describe('AgentSessionMessageService', () => {
  const dbh = setupTestDatabase()

  async function seedSession(values: Omit<AgentSessionInsert, 'workspaceId'> & { workspaceId?: string }) {
    const workspaceId = values.workspaceId ?? `workspace-${values.id}`
    await dbh.db.insert(agentWorkspaceTable).values({
      id: workspaceId,
      name: workspaceId,
      path: `/tmp/${workspaceId}`,
      type: 'user',
      orderKey: `workspace-${values.orderKey}`
    })
    await dbh.db
      .insert(agentSessionTable)
      .values({ createdAt: 0, lastActivityAt: 0, updatedAt: 0, ...values, workspaceId })
  }

  async function seedSessions(rows: Array<Omit<AgentSessionInsert, 'workspaceId'> & { workspaceId?: string }>) {
    for (const row of rows) {
      await seedSession(row)
    }
  }

  async function seedAgent(id: string, name: string, deletedAt?: number) {
    await dbh.db.insert(agentTable).values({
      id,
      type: 'claude-code',
      name,
      instructions: 'test',
      orderKey: id,
      deletedAt
    })
  }

  beforeEach(async () => {
    notifyDataApiDataChangeMock.mockClear()
    await seedSession({ id: SESSION_ID, name: 'Session', orderKey: 'a0' })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reports message existence per session', async () => {
    await seedSession({ id: 'session-2', name: 'Other', orderKey: 'a1' })
    expect(agentSessionMessageService.hasSessionMessages(SESSION_ID)).toBe(false)

    agentSessionMessageService.saveMessage({
      sessionId: SESSION_ID,
      message: { id: USER_MESSAGE_ID, role: 'user', status: 'success', data: { parts: [{ type: 'text', text: 'hi' }] } }
    })

    expect(agentSessionMessageService.hasSessionMessages(SESSION_ID)).toBe(true)
    expect(agentSessionMessageService.hasSessionMessages(SESSION_ID, USER_MESSAGE_ID)).toBe(false)
    expect(agentSessionMessageService.hasSessionMessages('session-2')).toBe(false)
  })

  describe('cross-session delivery', () => {
    it('persists same-Agent and cross-Agent envelopes before scheduling', async () => {
      await seedAgent('agent-a', 'Agent A')
      await seedAgent('agent-b', 'Agent B')
      await seedSession({ id: 'sender', agentId: 'agent-a', name: 'Sender', orderKey: 'b0' })
      await seedSession({ id: 'same-target', agentId: 'agent-a', name: 'Same target', orderKey: 'b1' })
      await seedSession({ id: 'cross-target', agentId: 'agent-b', name: 'Cross target', orderKey: 'b2' })

      const sameAgent = agentSessionMessageService.acceptSessionDelivery({
        senderAgentId: 'agent-a',
        senderSessionId: 'sender',
        receiverSessionId: 'same-target',
        content: 'same agent work'
      })
      const crossAgent = agentSessionMessageService.acceptSessionDelivery({
        senderAgentId: 'agent-a',
        senderSessionId: 'sender',
        receiverSessionId: 'cross-target',
        content: 'cross agent work'
      })

      expect(sameAgent.delivery).toMatchObject({
        sender: { agentId: 'agent-a', sessionId: 'sender' },
        receiver: { agentId: 'agent-a', sessionId: 'same-target' },
        replyPolicy: 'none',
        status: 'accepted'
      })
      expect(crossAgent.delivery).toMatchObject({
        receiver: { agentId: 'agent-b', sessionId: 'cross-target' },
        status: 'accepted'
      })
      expect(agentSessionMessageService.listRecoverableSessionDeliveries().map((message) => message.id)).toEqual([
        sameAgent.id,
        crossAgent.id
      ])
      expect(
        agentSessionMessageService.listRecoverableSessionDeliveries('same-target').map((message) => message.id)
      ).toEqual([sameAgent.id])
      expect(notifyDataApiDataChangeMock).toHaveBeenCalledWith([
        { endpoint: '/agent-sessions', kind: 'projection', entityIds: ['same-target'] },
        { endpoint: '/agent-sessions', kind: 'order', dimension: 'lastActivityAt', entityIds: ['same-target'] },
        { endpoint: '/agent-sessions/:sessionId', entityIds: ['same-target'] },
        { endpoint: '/agent-sessions/latest' },
        {
          endpoint: '/agent-sessions/:sessionId/messages',
          kind: 'membership',
          routeParams: { sessionId: 'same-target' },
          entityIds: [sameAgent.id]
        }
      ])
    })

    it('atomically creates a same-Agent Session with its first delivery', async () => {
      await seedAgent('agent-a', 'Agent A')
      await seedSession({ id: 'sender', agentId: 'agent-a', name: 'Sender', orderKey: 'b0' })
      await dbh.db.insert(agentWorkspaceTable).values({
        id: 'shared-workspace',
        name: 'Shared',
        path: '/tmp/shared-workspace',
        type: 'user',
        orderKey: 'workspace-shared'
      })

      const created = agentSessionMessageService.createSessionWithDelivery({
        senderAgentId: 'agent-a',
        senderSessionId: 'sender',
        sessionName: 'Fresh work',
        workspace: { type: 'user', workspaceId: 'shared-workspace' },
        content: 'Start here'
      })

      expect(created.session).toMatchObject({
        agentId: 'agent-a',
        name: 'Fresh work',
        workspaceId: 'shared-workspace'
      })
      expect(created.message).toMatchObject({
        sessionId: created.session.id,
        data: { parts: [{ type: 'text', text: 'Start here' }] },
        delivery: {
          sender: { agentId: 'agent-a', sessionId: 'sender' },
          receiver: { agentId: 'agent-a', sessionId: created.session.id },
          replyPolicy: 'completion',
          status: 'accepted'
        }
      })
      expect(notifyDataApiDataChangeMock).toHaveBeenCalledWith([
        { endpoint: '/agent-sessions', kind: 'membership', entityIds: [created.session.id] },
        {
          endpoint: '/agent-sessions/:sessionId/messages',
          kind: 'membership',
          entityIds: [created.message.id]
        }
      ])
    })

    it('rolls back the new Session when the sender identity is stale', async () => {
      await seedAgent('agent-a', 'Agent A')
      await seedAgent('agent-b', 'Agent B')
      await seedSession({ id: 'sender', agentId: 'agent-a', name: 'Sender', orderKey: 'b0' })
      await dbh.db.insert(agentWorkspaceTable).values({
        id: 'rollback-workspace',
        name: 'Rollback',
        path: '/tmp/rollback-workspace',
        type: 'user',
        orderKey: 'workspace-rollback'
      })
      const sessionsBefore = await dbh.db.select({ id: agentSessionTable.id }).from(agentSessionTable)

      expect(() =>
        agentSessionMessageService.createSessionWithDelivery({
          senderAgentId: 'agent-b',
          senderSessionId: 'sender',
          sessionName: 'Must roll back',
          workspace: { type: 'user', workspaceId: 'rollback-workspace' },
          content: 'Do not persist'
        })
      ).toThrow()

      const sessionsAfter = await dbh.db.select({ id: agentSessionTable.id }).from(agentSessionTable)
      expect(sessionsAfter).toEqual(sessionsBefore)
      expect(notifyDataApiDataChangeMock).not.toHaveBeenCalled()
    })

    it('rejects a forged sender identity without writing a message', async () => {
      await seedAgent('agent-a', 'Agent A')
      await seedAgent('agent-b', 'Agent B')
      await seedSession({ id: 'sender', agentId: 'agent-a', name: 'Sender', orderKey: 'b0' })
      await seedSession({ id: 'target', agentId: 'agent-b', name: 'Target', orderKey: 'b1' })

      expect(() =>
        agentSessionMessageService.acceptSessionDelivery({
          senderAgentId: 'agent-b',
          senderSessionId: 'sender',
          receiverSessionId: 'target',
          content: 'forged'
        })
      ).toThrowError(expect.objectContaining<Partial<AgentSessionDeliveryRoutingError>>({ code: 'SENDER_FORBIDDEN' }))
      expect(agentSessionMessageService.listSessionDeliveries('target')).toEqual([])
    })

    it('returns stable errors for missing, orphaned, and deleted targets', async () => {
      await seedAgent('agent-a', 'Agent A')
      await seedAgent('agent-deleted', 'Deleted', Date.now())
      await seedSession({ id: 'sender', agentId: 'agent-a', name: 'Sender', orderKey: 'b0' })
      await seedSession({ id: 'orphan', name: 'Orphan', orderKey: 'b1' })
      await seedSession({ id: 'deleted-target', agentId: 'agent-deleted', name: 'Deleted target', orderKey: 'b2' })

      const send = (receiverSessionId: string) =>
        agentSessionMessageService.acceptSessionDelivery({
          senderAgentId: 'agent-a',
          senderSessionId: 'sender',
          receiverSessionId,
          content: 'work'
        })

      expect(() => send('missing')).toThrowError(expect.objectContaining({ code: 'TARGET_SESSION_NOT_FOUND' }))
      expect(() => send('orphan')).toThrowError(expect.objectContaining({ code: 'TARGET_SESSION_ORPHANED' }))
      expect(() => send('deleted-target')).toThrowError(expect.objectContaining({ code: 'TARGET_AGENT_DELETED' }))
    })

    it('keeps accepted and delivering rows recoverable until terminal consumption', async () => {
      await seedAgent('agent-a', 'Agent A')
      await seedSession({ id: 'sender', agentId: 'agent-a', name: 'Sender', orderKey: 'b0' })
      await seedSession({ id: 'target', agentId: 'agent-a', name: 'Target', orderKey: 'b1' })
      const accepted = agentSessionMessageService.acceptSessionDelivery({
        senderAgentId: 'agent-a',
        senderSessionId: 'sender',
        receiverSessionId: 'target',
        content: 'durable work'
      })

      agentSessionMessageService.transitionSessionDelivery('target', accepted.id, 'delivering', {
        expected: ['accepted'],
        turnRef: 'assistant-turn'
      })
      expect(agentSessionMessageService.listRecoverableSessionDeliveries()).toHaveLength(1)

      const consumed = agentSessionMessageService.updateSessionDeliveryStatus('target', accepted.id, 'consumed')
      expect(consumed?.delivery).toMatchObject({ status: 'consumed', statusAt: expect.any(String) })
      expect(agentSessionMessageService.listRecoverableSessionDeliveries()).toEqual([])
    })

    it('rejects deleting a non-terminal delivery message', async () => {
      await seedAgent('agent-a', 'Agent A')
      await seedSession({ id: 'sender', agentId: 'agent-a', name: 'Sender', orderKey: 'b0' })
      await seedSession({ id: 'target', agentId: 'agent-a', name: 'Target', orderKey: 'b1' })
      const request = agentSessionMessageService.acceptSessionDelivery({
        senderAgentId: 'agent-a',
        senderSessionId: 'sender',
        receiverSessionId: 'target',
        content: 'durable work'
      })

      expect(() => agentSessionMessageService.deleteSessionMessage('target', request.id)).toThrowError(
        expect.objectContaining({ code: 'RESOURCE_LOCKED' })
      )
      expect(agentSessionMessageService.getSessionMessage('target', request.id).id).toBe(request.id)
    })

    it('finalizes one frozen completion result after terminal persistence', async () => {
      await seedAgent('agent-a', 'Agent A')
      await seedAgent('agent-b', 'Agent B')
      await seedSession({ id: 'sender', agentId: 'agent-a', name: 'Sender', orderKey: 'b0' })
      await seedSession({ id: 'target', agentId: 'agent-b', name: 'Target', orderKey: 'b1' })
      const request = agentSessionMessageService.acceptSessionDelivery({
        senderAgentId: 'agent-a',
        senderSessionId: 'sender',
        receiverSessionId: 'target',
        content: 'Do the work',
        replyPolicy: 'completion'
      })
      const assistantId = '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d090'
      agentSessionMessageService.saveMessage({
        sessionId: 'target',
        message: {
          id: assistantId,
          role: 'assistant',
          status: 'success',
          data: { parts: [{ type: 'text', text: 'Frozen result' }] }
        }
      })
      agentSessionMessageService.transitionSessionDelivery('target', request.id, 'delivering', {
        expected: ['accepted'],
        turnRef: assistantId
      })

      const first = agentSessionMessageService.finalizeSessionDelivery({
        requestSessionId: 'target',
        requestMessageId: request.id,
        assistantMessageId: assistantId,
        outcome: 'success'
      })
      const second = agentSessionMessageService.finalizeSessionDelivery({
        requestSessionId: 'target',
        requestMessageId: request.id,
        assistantMessageId: assistantId,
        outcome: 'success'
      })

      expect(first).toMatchObject({
        sessionId: 'sender',
        data: { parts: [{ type: 'text', text: 'Frozen result' }] },
        delivery: {
          inReplyTo: request.id,
          sourceMessageId: assistantId,
          outcome: 'success',
          status: 'accepted'
        }
      })
      expect(second).toBeNull()
      agentSessionMessageService.updateSessionMessage('target', assistantId, {
        data: { parts: [{ type: 'text', text: 'Edited later' }] }
      })
      expect(agentSessionMessageService.getSessionMessage('sender', first!.id).data).toEqual({
        parts: [{ type: 'text', text: 'Frozen result' }]
      })
      expect(agentSessionMessageService.getSessionMessage('target', request.id).delivery).toMatchObject({
        status: 'consumed',
        outcome: 'success'
      })
      expect(notifyDataApiDataChangeMock).toHaveBeenCalledWith([
        { endpoint: '/agent-sessions', kind: 'projection', entityIds: ['sender'] },
        { endpoint: '/agent-sessions', kind: 'order', dimension: 'lastActivityAt', entityIds: ['sender'] },
        { endpoint: '/agent-sessions/:sessionId', entityIds: ['sender'] },
        { endpoint: '/agent-sessions/latest' },
        {
          endpoint: '/agent-sessions/:sessionId/messages',
          kind: 'projection',
          routeParams: { sessionId: 'target' },
          entityIds: [request.id]
        },
        {
          endpoint: '/agent-sessions/:sessionId/messages',
          kind: 'membership',
          routeParams: { sessionId: 'sender' },
          entityIds: [first!.id]
        }
      ])
      expect(
        agentSessionMessageService
          .listSessionDeliveries({ sessionId: 'sender', requestId: request.id })
          .map((message) => message.id)
          .sort()
      ).toEqual([first!.id, request.id].sort())
    })

    it.each(['accepted', 'delivering'] as const)(
      'writes one sender failure result before clearing a %s completion request',
      async (status) => {
        await seedAgent('agent-a', 'Agent A')
        await seedAgent('agent-b', 'Agent B')
        await seedSession({ id: 'sender', agentId: 'agent-a', name: 'Sender', orderKey: 'b0' })
        await seedSession({ id: 'target', agentId: 'agent-b', name: 'Target', orderKey: 'b1' })
        const request = agentSessionMessageService.acceptSessionDelivery({
          senderAgentId: 'agent-a',
          senderSessionId: 'sender',
          receiverSessionId: 'target',
          content: 'Do the work',
          replyPolicy: 'completion'
        })
        if (status === 'delivering') {
          agentSessionMessageService.transitionSessionDelivery('target', request.id, 'delivering', {
            expected: ['accepted'],
            turnRef: 'assistant-turn'
          })
        }

        agentSessionMessageService.clearSessionMessages('target')

        expect(agentSessionMessageService.hasSessionMessages('target')).toBe(false)
        const [result] = agentSessionMessageService.listSessionDeliveries({
          sessionId: 'sender',
          requestId: request.id
        })
        expect(result).toMatchObject({
          sessionId: 'sender',
          data: {
            parts: [{ type: 'text', text: 'Target Session messages were cleared before completing the request.' }]
          },
          delivery: {
            inReplyTo: request.id,
            outcome: 'failed',
            error: { code: 'TARGET_SESSION_CLEARED' },
            status: 'accepted'
          }
        })
        expect(
          agentSessionMessageService.listSessionDeliveries({ sessionId: 'sender', requestId: request.id })
        ).toHaveLength(1)
      }
    )

    it.each(['accepted', 'delivering'] as const)(
      'does not resurrect a %s completion result in a cleared sender session',
      async (status) => {
        await seedAgent('agent-a', 'Agent A')
        await seedAgent('agent-b', 'Agent B')
        await seedSession({ id: 'sender', agentId: 'agent-a', name: 'Sender', orderKey: 'b0' })
        await seedSession({ id: 'target', agentId: 'agent-b', name: 'Target', orderKey: 'b1' })
        const request = agentSessionMessageService.acceptSessionDelivery({
          senderAgentId: 'agent-a',
          senderSessionId: 'sender',
          receiverSessionId: 'target',
          content: 'Do the work',
          replyPolicy: 'completion'
        })
        const assistantId = '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d091'
        agentSessionMessageService.saveMessage({
          sessionId: 'target',
          message: {
            id: assistantId,
            role: 'assistant',
            status: 'success',
            data: { parts: [{ type: 'text', text: 'Late result' }] }
          }
        })
        if (status === 'delivering') {
          agentSessionMessageService.transitionSessionDelivery('target', request.id, 'delivering', {
            expected: ['accepted'],
            turnRef: assistantId
          })
        }

        agentSessionMessageService.clearSessionMessages('sender')

        expect(agentSessionMessageService.hasSessionMessages('sender')).toBe(false)
        expect(agentSessionMessageService.getSessionMessage('target', request.id).delivery).toMatchObject({
          status: 'failed',
          outcome: 'failed',
          error: { code: 'CALLER_SESSION_CLEARED' }
        })
        expect(agentSessionMessageService.getSessionMessage('target', assistantId).id).toBe(assistantId)

        const finalized = agentSessionMessageService.finalizeSessionDelivery({
          requestSessionId: 'target',
          requestMessageId: request.id,
          assistantMessageId: assistantId,
          outcome: 'success'
        })
        const failed = agentSessionMessageService.failSessionDelivery(request, {
          code: 'CANCELLED',
          message: 'Late failure'
        })

        expect(finalized).toBeNull()
        expect(failed).toBeNull()
        expect(agentSessionMessageService.hasSessionMessages('sender')).toBe(false)
        expect(
          agentSessionMessageService
            .listSessionDeliveries({ sessionId: 'sender', requestId: request.id })
            .filter((message) => message.sessionId === 'sender' || message.delivery?.inReplyTo === request.id)
        ).toEqual([])
      }
    )

    it('leaves a none-policy target delivery intact when the sender is cleared', async () => {
      await seedAgent('agent-a', 'Agent A')
      await seedAgent('agent-b', 'Agent B')
      await seedSession({ id: 'sender', agentId: 'agent-a', name: 'Sender', orderKey: 'b0' })
      await seedSession({ id: 'target', agentId: 'agent-b', name: 'Target', orderKey: 'b1' })
      const request = agentSessionMessageService.acceptSessionDelivery({
        senderAgentId: 'agent-a',
        senderSessionId: 'sender',
        receiverSessionId: 'target',
        content: 'Fire and forget'
      })

      agentSessionMessageService.clearSessionMessages('sender')

      expect(agentSessionMessageService.hasSessionMessages('sender')).toBe(false)
      expect(agentSessionMessageService.getSessionMessage('target', request.id).delivery).toMatchObject({
        status: 'accepted',
        replyPolicy: 'none'
      })
    })

    it('does not invent a sender result when clearing a none-policy delivery', async () => {
      await seedAgent('agent-a', 'Agent A')
      await seedAgent('agent-b', 'Agent B')
      await seedSession({ id: 'sender', agentId: 'agent-a', name: 'Sender', orderKey: 'b0' })
      await seedSession({ id: 'target', agentId: 'agent-b', name: 'Target', orderKey: 'b1' })
      const request = agentSessionMessageService.acceptSessionDelivery({
        senderAgentId: 'agent-a',
        senderSessionId: 'sender',
        receiverSessionId: 'target',
        content: 'Fire and forget'
      })

      agentSessionMessageService.clearSessionMessages('target')

      expect(agentSessionMessageService.hasSessionMessages('target')).toBe(false)
      expect(agentSessionMessageService.listSessionDeliveries({ sessionId: 'sender', requestId: request.id })).toEqual(
        []
      )
    })

    it('keeps an existing completion result and does not throw when the sender is already gone', async () => {
      await seedAgent('agent-a', 'Agent A')
      await seedAgent('agent-b', 'Agent B')
      await seedSession({ id: 'sender', agentId: 'agent-a', name: 'Sender', orderKey: 'b0' })
      await seedSession({ id: 'orphan-sender', agentId: 'agent-a', name: 'Orphan sender', orderKey: 'b1' })
      await seedSession({ id: 'target', agentId: 'agent-b', name: 'Target', orderKey: 'b2' })
      const request = agentSessionMessageService.acceptSessionDelivery({
        senderAgentId: 'agent-a',
        senderSessionId: 'sender',
        receiverSessionId: 'target',
        content: 'Do the work',
        replyPolicy: 'completion'
      })
      const existing = agentSessionMessageService.failSessionDelivery(request, {
        code: 'CANCELLED',
        message: 'Already failed'
      })
      const orphaned = agentSessionMessageService.acceptSessionDelivery({
        senderAgentId: 'agent-a',
        senderSessionId: 'orphan-sender',
        receiverSessionId: 'target',
        content: 'Do more work',
        replyPolicy: 'completion'
      })
      agentSessionService.delete('orphan-sender')

      expect(() => agentSessionMessageService.clearSessionMessages('target')).not.toThrow()
      expect(agentSessionMessageService.hasSessionMessages('target')).toBe(false)
      expect(agentSessionMessageService.getSessionMessage('sender', existing!.id).delivery).toMatchObject({
        inReplyTo: request.id,
        outcome: 'failed',
        error: { code: 'CANCELLED' }
      })
      expect(
        agentSessionMessageService.listSessionDeliveries({ sessionId: 'sender', requestId: request.id })
      ).toHaveLength(1)
      expect(agentSessionMessageService.listSessionDeliveries({ sessionId: 'sender', requestId: orphaned.id })).toEqual(
        []
      )
    })

    it('creates a failure result before deleting a target with an unfinished completion request', async () => {
      await seedAgent('agent-a', 'Agent A')
      await seedAgent('agent-b', 'Agent B')
      await seedSession({ id: 'sender', agentId: 'agent-a', name: 'Sender', orderKey: 'b0' })
      await seedSession({ id: 'target', agentId: 'agent-b', name: 'Target', orderKey: 'b1' })
      const request = agentSessionMessageService.acceptSessionDelivery({
        senderAgentId: 'agent-a',
        senderSessionId: 'sender',
        receiverSessionId: 'target',
        content: 'Do the work',
        replyPolicy: 'completion'
      })

      agentSessionService.delete('target')

      const [result] = agentSessionMessageService.listSessionDeliveries({
        sessionId: 'sender',
        requestId: request.id
      })
      expect(result).toMatchObject({
        sessionId: 'sender',
        delivery: {
          inReplyTo: request.id,
          outcome: 'failed',
          error: { code: 'TARGET_SESSION_DELETED' }
        }
      })
    })

    it('interrupts an active completion before deleting its Agent while retaining the target Session', async () => {
      await seedAgent('agent-a', 'Agent A')
      await seedAgent('agent-b', 'Agent B')
      await seedSession({ id: 'sender', agentId: 'agent-a', name: 'Sender', orderKey: 'b0' })
      await seedSession({ id: 'target', agentId: 'agent-b', name: 'Target', orderKey: 'b1' })
      const request = agentSessionMessageService.acceptSessionDelivery({
        senderAgentId: 'agent-a',
        senderSessionId: 'sender',
        receiverSessionId: 'target',
        content: 'Do the work',
        replyPolicy: 'completion'
      })
      agentSessionMessageService.transitionSessionDelivery('target', request.id, 'delivering', {
        expected: ['accepted'],
        turnRef: 'assistant-turn'
      })

      agentService.deleteAgent('agent-b', { deleteSessions: false })

      expect(agentSessionMessageService.getSessionMessage('target', request.id).delivery).toMatchObject({
        status: 'failed',
        outcome: 'interrupted',
        error: { code: 'TARGET_AGENT_DELETED' }
      })
      expect(agentSessionService.getById('target').agentId).toBeNull()
      const [result] = agentSessionMessageService.listSessionDeliveries({ sessionId: 'sender', requestId: request.id })
      expect(result.delivery).toMatchObject({
        inReplyTo: request.id,
        outcome: 'interrupted',
        error: { code: 'TARGET_AGENT_DELETED' }
      })
    })
  })

  describe('findCrashOrphanedAssistantMessages + resolveCrashOrphanedMessages (boot reconcile)', () => {
    it('finds only pending assistant rows and resolves them to error with the given data', async () => {
      const now = vi.spyOn(Date, 'now').mockReturnValue(1_000)
      const PENDING = '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d010'
      const DONE = '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d011'
      const PENDING_USER = '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d012'
      agentSessionMessageService.saveMessage({
        sessionId: SESSION_ID,
        message: { id: PENDING, role: 'assistant', status: 'pending', data: { parts: [] } }
      })
      agentSessionMessageService.saveMessage({
        sessionId: SESSION_ID,
        message: { id: DONE, role: 'assistant', status: 'success', data: { parts: [{ type: 'text', text: 'done' }] } }
      })
      agentSessionMessageService.saveMessage({
        sessionId: SESSION_ID,
        message: { id: PENDING_USER, role: 'user', status: 'pending', data: { parts: [{ type: 'text', text: 'q' }] } }
      })

      expect(agentSessionMessageService.findCrashOrphanedAssistantMessages()).toEqual([
        { id: PENDING, sessionId: SESSION_ID, data: { parts: [] } }
      ])

      now.mockReturnValue(5_000)
      const finalizedData = { parts: [{ type: 'text' as const, text: 'terminalized' }] }
      agentSessionMessageService.resolveCrashOrphanedMessages([{ id: PENDING, data: finalizedData }], [SESSION_ID])
      expect(agentSessionMessageService.findCrashOrphanedAssistantMessages()).toEqual([])
      const [row] = await dbh.db.select().from(agentSessionMessageTable).where(eq(agentSessionMessageTable.id, PENDING))
      const [session] = await dbh.db.select().from(agentSessionTable).where(eq(agentSessionTable.id, SESSION_ID))
      expect(row.status).toBe('error')
      expect(row.data).toEqual(finalizedData)
      expect(session.lastActivityAt).toBe(1_000)
    })

    it('finds settled assistant rows whose approval registry was lost on restart', () => {
      const ORPHANED = '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d013'
      const COMPLETE = '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d014'
      agentSessionMessageService.saveMessage({
        sessionId: SESSION_ID,
        message: {
          id: ORPHANED,
          role: 'assistant',
          status: 'success',
          data: {
            parts: [
              {
                type: 'dynamic-tool',
                toolCallId: 'tool-call-1',
                toolName: 'screenshot',
                state: 'approval-requested',
                input: {},
                approval: { id: 'approval-1' }
              }
            ]
          }
        }
      })
      agentSessionMessageService.saveMessage({
        sessionId: SESSION_ID,
        message: {
          id: COMPLETE,
          role: 'assistant',
          status: 'success',
          data: {
            parts: [
              {
                type: 'dynamic-tool',
                toolCallId: 'tool-call-2',
                toolName: 'list_tabs',
                state: 'output-available',
                input: {},
                output: {}
              }
            ]
          }
        }
      })

      expect(agentSessionMessageService.findCrashOrphanedAssistantMessages()).toEqual([
        expect.objectContaining({ id: ORPHANED, sessionId: SESSION_ID })
      ])
    })

    it('discards resume tokens only for the affected sessions', async () => {
      const OTHER_SESSION_ID = 'session-2'
      await seedSession({ id: OTHER_SESSION_ID, name: 'Other', orderKey: 'a1' })
      const PENDING = '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d020'
      const EARLIER = '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d021'
      const OTHER = '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d022'
      agentSessionMessageService.saveMessage({
        sessionId: SESSION_ID,
        runtimeResumeToken: 'token-earlier',
        message: { id: EARLIER, role: 'assistant', status: 'success', data: { parts: [] } }
      })
      agentSessionMessageService.saveMessage({
        sessionId: SESSION_ID,
        runtimeResumeToken: 'token-crashed',
        message: { id: PENDING, role: 'assistant', status: 'pending', data: { parts: [] } }
      })
      agentSessionMessageService.saveMessage({
        sessionId: OTHER_SESSION_ID,
        runtimeResumeToken: 'token-other',
        message: { id: OTHER, role: 'assistant', status: 'success', data: { parts: [] } }
      })

      agentSessionMessageService.resolveCrashOrphanedMessages([{ id: PENDING, data: { parts: [] } }], [SESSION_ID])

      // The whole crashed session loses its tokens — the earlier turn's token would still resume
      // the untrusted external CLI state, so the next connection must start without one.
      expect(agentSessionMessageService.getLastRuntimeResumeToken(SESSION_ID)).toBeNull()
      expect(agentSessionMessageService.getLastRuntimeResumeToken(OTHER_SESSION_ID)).toBe('token-other')
    })
  })

  it('atomically settles a persisted background tool approval with the user-updated input', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000)
    agentSessionMessageService.saveMessage({
      sessionId: SESSION_ID,
      message: {
        id: ASSISTANT_MESSAGE_ID,
        role: 'assistant',
        status: 'success',
        data: {
          parts: [
            {
              type: 'tool-AskUserQuestion',
              toolCallId: 'tool-call-1',
              state: 'approval-requested',
              input: { questions: [] },
              approval: { id: 'approval-1' }
            }
          ]
        }
      }
    })
    const updatedInput = { questions: [], answers: { Choice: 'SQLite' } }

    now.mockReturnValue(2_000)
    expect(
      agentSessionMessageService.applyToolApprovalDecision(SESSION_ID, ASSISTANT_MESSAGE_ID, {
        approvalId: 'approval-1',
        approved: true,
        updatedInput
      })
    ).toBe(true)

    const saved = agentSessionMessageService.getSessionMessage(SESSION_ID, ASSISTANT_MESSAGE_ID)
    expect(saved.data.parts?.[0]).toMatchObject({
      state: 'approval-responded',
      input: updatedInput,
      approval: { id: 'approval-1', approved: true }
    })
    const [session] = dbh.db.select().from(agentSessionTable).where(eq(agentSessionTable.id, SESSION_ID)).all()
    expect(session.lastActivityAt).toBe(2_000)
    now.mockRestore()
  })

  it('keeps attachment refs in sync with agent-session message history', async () => {
    await dbh.db.insert(fileEntryTable).values({
      id: FILE_ENTRY_ID,
      origin: 'internal',
      name: 'report',
      ext: 'pdf',
      size: 42,
      cleanupPolicy: 'delete_when_unreferenced'
    })
    const filePart = {
      type: 'file' as const,
      url: 'file:///stale/location/report.pdf',
      mediaType: 'application/pdf',
      filename: 'report.pdf',
      providerMetadata: { cherry: { fileEntryId: FILE_ENTRY_ID } }
    }

    agentSessionMessageService.saveMessage({
      sessionId: SESSION_ID,
      message: {
        id: USER_MESSAGE_ID,
        role: 'user',
        data: { parts: [{ type: 'text', text: 'inspect' }, filePart, filePart] }
      }
    })

    expect(await dbh.db.select().from(agentSessionMessageFileRefTable)).toEqual([
      expect.objectContaining({ fileEntryId: FILE_ENTRY_ID, sourceId: USER_MESSAGE_ID, role: 'attachment' })
    ])

    agentSessionMessageService.updateSessionMessage(SESSION_ID, USER_MESSAGE_ID, {
      data: { parts: [{ type: 'text', text: 'attachment removed' }] }
    })
    expect(await dbh.db.select().from(agentSessionMessageFileRefTable)).toEqual([])

    agentSessionMessageService.saveMessage({
      sessionId: SESSION_ID,
      message: { id: USER_MESSAGE_ID, role: 'user', data: { parts: [filePart] } }
    })
    agentSessionMessageService.deleteSessionMessage(SESSION_ID, USER_MESSAGE_ID)
    expect(await dbh.db.select().from(agentSessionMessageFileRefTable)).toEqual([])
  })

  it('creates messages with service-owned audit timestamps', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)

    const saved = agentSessionMessageService.saveMessage({
      sessionId: SESSION_ID,
      message: {
        id: USER_MESSAGE_ID,
        role: 'user',
        data: { parts: [{ type: 'text', text: 'hello' }] }
      }
    })

    const [row] = await dbh.db
      .select()
      .from(agentSessionMessageTable)
      .where(eq(agentSessionMessageTable.id, USER_MESSAGE_ID))
    const [session] = await dbh.db.select().from(agentSessionTable).where(eq(agentSessionTable.id, SESSION_ID))

    expect(row.createdAt).toBe(1_700_000_000_000)
    expect(row.updatedAt).toBe(1_700_000_000_000)
    expect(session.updatedAt).toBe(1_700_000_000_000)
    expect(session.lastActivityAt).toBe(1_700_000_000_000)
    expect(saved.createdAt).toBe('2023-11-14T22:13:20.000Z')
    expect(saved.updatedAt).toBe('2023-11-14T22:13:20.000Z')
  })

  it('writes neither user nor pending assistant when the session agent changed before the transaction', async () => {
    expect(() =>
      agentSessionMessageService.saveMessages(
        {
          sessionId: SESSION_ID,
          messages: [
            { id: USER_MESSAGE_ID, role: 'user', status: 'success', data: { parts: [{ type: 'text', text: 'run' }] } },
            { id: ASSISTANT_MESSAGE_ID, role: 'assistant', status: 'pending', data: { parts: [] } }
          ]
        },
        'agent-that-no-longer-owns-session'
      )
    ).toThrow(`Session with id '${SESSION_ID}' not found`)

    expect(
      await dbh.db.select().from(agentSessionMessageTable).where(eq(agentSessionMessageTable.sessionId, SESSION_ID))
    ).toEqual([])
  })

  it('writes neither message when the owning Agent changed after validation', async () => {
    await seedAgent('agent-a', 'Agent A')
    await dbh.db.update(agentSessionTable).set({ agentId: 'agent-a' }).where(eq(agentSessionTable.id, SESSION_ID))
    const [agent] = await dbh.db.select().from(agentTable).where(eq(agentTable.id, 'agent-a'))
    await dbh.db
      .update(agentTable)
      .set({ name: 'Agent A updated', updatedAt: agent.updatedAt + 1 })
      .where(eq(agentTable.id, 'agent-a'))

    expect(() =>
      agentSessionMessageService.saveMessages(
        {
          sessionId: SESSION_ID,
          messages: [
            { id: USER_MESSAGE_ID, role: 'user', status: 'success', data: { parts: [{ type: 'text', text: 'run' }] } },
            { id: ASSISTANT_MESSAGE_ID, role: 'assistant', status: 'pending', data: { parts: [] } }
          ]
        },
        {
          id: 'agent-a',
          updatedAt: new Date(agent.updatedAt).toISOString(),
          model: 'provider::validated-model',
          type: 'claude-code'
        }
      )
    ).toThrow("Agent 'agent-a' was modified by another user")

    expect(
      await dbh.db.select().from(agentSessionMessageTable).where(eq(agentSessionMessageTable.sessionId, SESSION_ID))
    ).toEqual([])
  })

  it('compares legacy cherry-claw rows by their normalized runtime type', async () => {
    dbh.db.insert(userProviderTable).values({ providerId: 'legacy', name: 'Legacy', orderKey: 'p0' }).run()
    dbh.db
      .insert(userModelTable)
      .values({
        id: 'legacy::model',
        providerId: 'legacy',
        modelId: 'model',
        presetModelId: 'model',
        name: 'Legacy model',
        isEnabled: true,
        isHidden: false,
        orderKey: 'm0'
      })
      .run()
    dbh.db
      .insert(agentTable)
      .values({
        id: 'legacy-agent',
        type: 'cherry-claw',
        name: 'Legacy Agent',
        instructions: '',
        model: 'legacy::model',
        orderKey: 'a0'
      })
      .run()
    dbh.db.update(agentSessionTable).set({ agentId: 'legacy-agent' }).where(eq(agentSessionTable.id, SESSION_ID)).run()
    const [agent] = dbh.db.select().from(agentTable).where(eq(agentTable.id, 'legacy-agent')).all()

    expect(() =>
      agentSessionMessageService.saveMessages(
        {
          sessionId: SESSION_ID,
          messages: [
            { id: USER_MESSAGE_ID, role: 'user', status: 'success', data: { parts: [{ type: 'text', text: 'run' }] } },
            { id: ASSISTANT_MESSAGE_ID, role: 'assistant', status: 'pending', data: { parts: [] } }
          ]
        },
        {
          id: 'legacy-agent',
          updatedAt: new Date(agent.updatedAt).toISOString(),
          model: 'legacy::model',
          type: 'claude-code'
        }
      )
    ).not.toThrow()
  })

  it('terminalizes a pending assistant after live persistence fails', () => {
    agentSessionMessageService.saveMessage({
      sessionId: SESSION_ID,
      runtimeResumeToken: 'resume-token',
      message: { id: USER_MESSAGE_ID, role: 'user', status: 'success', data: { parts: [] } }
    })
    agentSessionMessageService.saveMessage({
      sessionId: SESSION_ID,
      message: { id: ASSISTANT_MESSAGE_ID, role: 'assistant', status: 'pending', data: { parts: [] } }
    })
    notifyDataApiDataChangeMock.mockClear()

    agentSessionMessageService.markAssistantMessageTerminalError(SESSION_ID, ASSISTANT_MESSAGE_ID)

    expect(agentSessionMessageService.getSessionMessage(SESSION_ID, ASSISTANT_MESSAGE_ID).status).toBe('error')
    expect(agentSessionMessageService.getLastRuntimeResumeToken(SESSION_ID)).toBe('resume-token')
    expect(notifyDataApiDataChangeMock).toHaveBeenCalledWith([
      {
        endpoint: '/agent-sessions/:sessionId/messages',
        kind: 'projection',
        routeParams: { sessionId: SESSION_ID },
        entityIds: [ASSISTANT_MESSAGE_ID]
      }
    ])
  })

  it('keeps createdAt stable when updating an existing message', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)

    const created = agentSessionMessageService.saveMessage({
      sessionId: SESSION_ID,
      message: {
        id: USER_MESSAGE_ID,
        role: 'user',
        data: { parts: [{ type: 'text', text: 'hello' }] }
      }
    })
    now.mockReturnValue(1_700_000_000_500)
    const updated = agentSessionMessageService.saveMessage({
      sessionId: SESSION_ID,
      message: {
        id: USER_MESSAGE_ID,
        role: 'user',
        data: { parts: [{ type: 'text', text: 'edited' }] }
      }
    })

    const [row] = await dbh.db
      .select()
      .from(agentSessionMessageTable)
      .where(eq(agentSessionMessageTable.id, USER_MESSAGE_ID))
    const [session] = await dbh.db.select().from(agentSessionTable).where(eq(agentSessionTable.id, SESSION_ID))

    expect(row.createdAt).toBe(1_700_000_000_000)
    expect(row.updatedAt).toBe(1_700_000_000_500)
    expect(session.updatedAt).toBe(1_700_000_000_500)
    expect(session.lastActivityAt).toBe(1_700_000_000_000)
    expect(updated.createdAt).toBe(created.createdAt)
    expect(updated.updatedAt).toBe('2023-11-14T22:13:20.500Z')
  })

  it('advances each pending assistant response segment but not a terminal rewrite', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
    agentSessionMessageService.saveMessage({
      sessionId: SESSION_ID,
      message: { id: ASSISTANT_MESSAGE_ID, role: 'assistant', status: 'pending', data: { parts: [] } }
    })

    now.mockReturnValue(1_700_000_000_500)
    agentSessionMessageService.saveMessage({
      sessionId: SESSION_ID,
      message: {
        id: ASSISTANT_MESSAGE_ID,
        role: 'assistant',
        status: 'success',
        data: { parts: [{ type: 'text', text: 'done' }] }
      }
    })

    now.mockReturnValue(1_700_000_001_000)
    agentSessionMessageService.saveMessage({
      sessionId: SESSION_ID,
      message: {
        id: ASSISTANT_MESSAGE_ID,
        role: 'assistant',
        status: 'success',
        data: { parts: [{ type: 'text', text: 'projection rewrite' }] }
      }
    })

    const [message] = await dbh.db
      .select()
      .from(agentSessionMessageTable)
      .where(eq(agentSessionMessageTable.id, ASSISTANT_MESSAGE_ID))
    const [session] = await dbh.db.select().from(agentSessionTable).where(eq(agentSessionTable.id, SESSION_ID))
    expect(session.lastActivityAt).toBe(1_700_000_000_500)
    expect(session.updatedAt).toBe(1_700_000_001_000)

    now.mockReturnValue(1_700_000_001_500)
    agentSessionMessageService.saveMessage({
      sessionId: SESSION_ID,
      message: { id: ASSISTANT_MESSAGE_ID, role: 'assistant', status: 'pending', data: message.data }
    })
    now.mockReturnValue(1_700_000_002_000)
    agentSessionMessageService.saveMessage({
      sessionId: SESSION_ID,
      message: { id: ASSISTANT_MESSAGE_ID, role: 'assistant', status: 'success', data: message.data }
    })

    const [continuedSession] = await dbh.db.select().from(agentSessionTable).where(eq(agentSessionTable.id, SESSION_ID))
    expect(continuedSession.lastActivityAt).toBe(1_700_000_002_000)
  })

  it('keeps session activity after messages are deleted', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000)
    agentSessionMessageService.saveMessage({
      sessionId: SESSION_ID,
      message: { id: USER_MESSAGE_ID, role: 'user', status: 'success', data: { parts: [] } }
    })
    now.mockReturnValue(2_000)
    agentSessionMessageService.saveMessage({
      sessionId: SESSION_ID,
      message: { id: ASSISTANT_MESSAGE_ID, role: 'assistant', status: 'pending', data: { parts: [] } }
    })
    now.mockReturnValue(3_000)
    agentSessionMessageService.saveMessage({
      sessionId: SESSION_ID,
      message: { id: ASSISTANT_MESSAGE_ID, role: 'assistant', status: 'success', data: { parts: [] } }
    })

    agentSessionMessageService.deleteSessionMessage(SESSION_ID, ASSISTANT_MESSAGE_ID)
    const [session] = await dbh.db.select().from(agentSessionTable).where(eq(agentSessionTable.id, SESSION_ID))
    expect(session.lastActivityAt).toBe(3_000)

    agentSessionMessageService.deleteSessionMessage(SESSION_ID, USER_MESSAGE_ID)
    const [emptySession] = await dbh.db.select().from(agentSessionTable).where(eq(agentSessionTable.id, SESSION_ID))
    expect(emptySession.lastActivityAt).toBe(3_000)
  })

  it('clears only the requested session messages and leaves other sessions untouched', async () => {
    const otherSessionId = 'session-other-clear'
    await seedSession({ id: otherSessionId, name: 'Other Session', orderKey: 'c0' })
    agentSessionMessageService.saveMessage({
      sessionId: SESSION_ID,
      message: { id: USER_MESSAGE_ID, role: 'user', status: 'success', data: { parts: [] } }
    })
    agentSessionMessageService.saveMessage({
      sessionId: SESSION_ID,
      message: { id: ASSISTANT_MESSAGE_ID, role: 'assistant', status: 'success', data: { parts: [] } }
    })
    agentSessionMessageService.saveMessage({
      sessionId: otherSessionId,
      message: {
        id: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d004',
        role: 'user',
        status: 'success',
        data: { parts: [{ type: 'text', text: 'keep' }] }
      }
    })

    const result = agentSessionMessageService.clearSessionMessages(SESSION_ID)

    expect(result.deletedIds.sort()).toEqual([ASSISTANT_MESSAGE_ID, USER_MESSAGE_ID].sort())
    expect(agentSessionMessageService.hasSessionMessages(SESSION_ID)).toBe(false)
    expect(
      agentSessionMessageService.getSessionMessage(otherSessionId, '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d004').id
    ).toBe('018f6ed6-73b8-7f40-8d0d-9bb2f8f1d004')
    expect(notifyDataApiDataChangeMock).toHaveBeenCalledWith([
      {
        endpoint: '/agent-sessions/:sessionId/messages',
        kind: 'membership',
        routeParams: { sessionId: SESSION_ID },
        entityIds: result.deletedIds
      }
    ])
  })

  it('is a no-op for an empty session and rejects a missing session', () => {
    expect(agentSessionMessageService.clearSessionMessages(SESSION_ID)).toEqual({ deletedIds: [] })
    expect(notifyDataApiDataChangeMock).not.toHaveBeenCalled()
    expect(() => agentSessionMessageService.clearSessionMessages('missing-session')).toThrow(
      "Session with id 'missing-session' not found"
    )
  })

  it('updates an existing assistant placeholder and does not recreate it after clear', () => {
    agentSessionMessageService.saveMessage({
      sessionId: SESSION_ID,
      message: {
        id: ASSISTANT_MESSAGE_ID,
        role: 'assistant',
        status: 'pending',
        data: { parts: [] }
      }
    })

    const updated = agentSessionMessageService.persistExistingAssistantMessage(
      {
        sessionId: SESSION_ID,
        message: {
          id: ASSISTANT_MESSAGE_ID,
          role: 'assistant',
          status: 'success',
          data: { parts: [{ type: 'text', text: 'done' }] }
        }
      },
      { publishDataChange: true }
    )
    expect(updated).toMatchObject({
      id: ASSISTANT_MESSAGE_ID,
      status: 'success',
      data: { parts: [{ type: 'text', text: 'done' }] }
    })

    agentSessionMessageService.clearSessionMessages(SESSION_ID)
    const latePersist = agentSessionMessageService.persistExistingAssistantMessage(
      {
        sessionId: SESSION_ID,
        message: {
          id: ASSISTANT_MESSAGE_ID,
          role: 'assistant',
          status: 'success',
          data: { parts: [{ type: 'text', text: 'resurrected' }] }
        }
      },
      { publishDataChange: true }
    )

    expect(latePersist).toBeNull()
    expect(agentSessionMessageService.hasSessionMessages(SESSION_ID)).toBe(false)
  })

  it('publishes the data change derived from an inserted or updated message', () => {
    agentSessionMessageService.saveMessage(
      {
        sessionId: SESSION_ID,
        message: {
          id: USER_MESSAGE_ID,
          role: 'user',
          data: { parts: [{ type: 'text', text: 'hello' }] }
        }
      },
      { publishDataChange: true }
    )

    expect(notifyDataApiDataChangeMock).toHaveBeenLastCalledWith(
      expect.arrayContaining([
        { endpoint: '/agent-sessions/latest' },
        {
          endpoint: '/agent-sessions/:sessionId/messages',
          kind: 'membership',
          routeParams: { sessionId: SESSION_ID },
          entityIds: [USER_MESSAGE_ID]
        }
      ])
    )

    agentSessionMessageService.saveMessage(
      {
        sessionId: SESSION_ID,
        message: {
          id: USER_MESSAGE_ID,
          role: 'user',
          data: { parts: [{ type: 'text', text: 'updated' }] }
        }
      },
      { publishDataChange: true }
    )

    expect(notifyDataApiDataChangeMock).toHaveBeenLastCalledWith([
      {
        endpoint: '/agent-sessions/:sessionId/messages',
        kind: 'projection',
        routeParams: { sessionId: SESSION_ID },
        entityIds: [USER_MESSAGE_ID]
      }
    ])
  })

  it('reads and updates message data within the owning Agent session', async () => {
    const otherSessionId = 'session-other-update'
    await seedSession({ id: otherSessionId, name: 'Other Session', orderKey: 'b0' })
    agentSessionMessageService.saveMessage({
      sessionId: SESSION_ID,
      message: {
        id: ASSISTANT_MESSAGE_ID,
        role: 'assistant',
        status: 'error',
        data: { parts: [{ type: 'data-error', data: { message: 'failed' } }] }
      }
    })

    expect(agentSessionMessageService.getSessionMessage(SESSION_ID, ASSISTANT_MESSAGE_ID).status).toBe('error')
    expect(() => agentSessionMessageService.getSessionMessage(otherSessionId, ASSISTANT_MESSAGE_ID)).toThrow(
      "Message with id '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d002' not found"
    )

    const data = {
      parts: [
        {
          type: 'data-error' as const,
          data: { message: 'failed' },
          providerMetadata: { cherry: { diagnosis: { summary: 'Check the provider' } } }
        }
      ]
    }
    const updated = agentSessionMessageService.updateSessionMessage(SESSION_ID, ASSISTANT_MESSAGE_ID, { data })

    expect(updated.data).toEqual(data)
    expect(updated.status).toBe('error')
    expect(() =>
      agentSessionMessageService.updateSessionMessage(otherSessionId, ASSISTANT_MESSAGE_ID, { data })
    ).toThrow("Message with id '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d002' not found")
  })

  it('preserves turnOptions when a data patch sends only parts', () => {
    agentSessionMessageService.saveMessage({
      sessionId: SESSION_ID,
      message: {
        id: ASSISTANT_MESSAGE_ID,
        role: 'assistant',
        status: 'success',
        data: { parts: [{ type: 'text', text: 'answer' }], turnOptions: { reasoningEffort: 'high', fastMode: true } }
      }
    })

    const updated = agentSessionMessageService.updateSessionMessage(SESSION_ID, ASSISTANT_MESSAGE_ID, {
      data: { parts: [{ type: 'text', text: 'edited' }] }
    })

    expect(updated.data.parts).toEqual([{ type: 'text', text: 'edited' }])
    expect(updated.data.turnOptions).toEqual({ reasoningEffort: 'high', fastMode: true })
  })

  it('replaces parts on the original assistant row', () => {
    agentSessionMessageService.saveMessage({
      sessionId: SESSION_ID,
      message: {
        id: ASSISTANT_MESSAGE_ID,
        role: 'assistant',
        status: 'success',
        data: {
          parts: [
            {
              type: 'tool-Agent',
              toolCallId: 'task-root',
              state: 'input-available',
              input: { prompt: 'Audit' }
            }
          ]
        }
      }
    })

    agentSessionMessageService.replaceMessageParts(SESSION_ID, ASSISTANT_MESSAGE_ID, [
      {
        type: 'tool-Agent',
        toolCallId: 'task-root',
        state: 'input-available',
        input: { prompt: 'Audit' }
      },
      {
        type: 'text',
        text: 'Subagent finished',
        providerMetadata: { cherry: { parentToolCallId: 'task-root' } }
      }
    ])

    const saved = agentSessionMessageService.getSessionMessage(SESSION_ID, ASSISTANT_MESSAGE_ID)
    expect(saved.status).toBe('success')
    expect(saved.data.parts).toEqual([
      expect.objectContaining({ toolCallId: 'task-root' }),
      expect.objectContaining({ type: 'text', text: 'Subagent finished' })
    ])
    expect(notifyDataApiDataChangeMock).toHaveBeenCalledWith([
      {
        endpoint: '/agent-sessions/:sessionId/messages',
        kind: 'projection',
        routeParams: { sessionId: SESSION_ID },
        entityIds: [ASSISTANT_MESSAGE_ID]
      }
    ])
  })

  it('keeps the session timestamp aligned with a newly saved message batch', async () => {
    vi.spyOn(Date, 'now').mockReturnValueOnce(1_700_000_001_000).mockReturnValue(1_700_000_002_000)

    agentSessionMessageService.saveMessages({
      sessionId: SESSION_ID,
      messages: [
        {
          id: USER_MESSAGE_ID,
          role: 'user',
          data: { parts: [{ type: 'text', text: 'hello' }] }
        },
        {
          id: ASSISTANT_MESSAGE_ID,
          role: 'assistant',
          status: 'pending',
          data: { parts: [] }
        }
      ]
    })

    const rows = await dbh.db.select().from(agentSessionMessageTable)
    const [session] = await dbh.db.select().from(agentSessionTable).where(eq(agentSessionTable.id, SESSION_ID))

    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.createdAt)).toEqual([1_700_000_001_000, 1_700_000_001_000])
    expect(session.updatedAt).toBe(1_700_000_001_000)
  })

  it('pages body-free canonical metadata in a closed range without skipping timestamp ties', async () => {
    await dbh.db.insert(agentSessionMessageTable).values([
      {
        id: 'range-start',
        sessionId: SESSION_ID,
        role: 'user',
        data: { parts: [{ type: 'text', text: 'start' }] },
        status: 'success',
        createdAt: 100,
        updatedAt: 100
      },
      {
        id: 'range-tie-a',
        sessionId: SESSION_ID,
        role: 'assistant',
        data: { parts: [{ type: 'text', text: 'tie a' }] },
        status: 'success',
        createdAt: 200,
        updatedAt: 200
      },
      {
        id: 'range-tie-z',
        sessionId: SESSION_ID,
        role: 'assistant',
        data: { parts: [{ type: 'text', text: 'tie z' }] },
        status: 'success',
        createdAt: 200,
        updatedAt: 200
      },
      {
        id: 'range-end',
        sessionId: SESSION_ID,
        role: 'assistant',
        data: { parts: [{ type: 'text', text: '结束🙂\n"quoted"\\slash' }] },
        status: 'success',
        runtimeResumeToken: 'resume-token',
        delivery: {
          version: 1,
          sender: { agentId: 'sender-agent', sessionId: 'sender-session' },
          receiver: { agentId: 'receiver-agent', sessionId: SESSION_ID },
          replyPolicy: 'completion',
          sourceMessageId: null,
          outcome: null,
          error: null,
          statusAt: '1970-01-01T00:00:00.300Z'
        },
        deliveryStatus: 'accepted',
        deliveryInReplyTo: null,
        deliveryTurnRef: null,
        createdAt: 300,
        updatedAt: 300
      },
      {
        id: 'range-before',
        sessionId: SESSION_ID,
        role: 'user',
        data: { parts: [{ type: 'text', text: 'before' }] },
        status: 'success',
        createdAt: 99,
        updatedAt: 99
      },
      {
        id: 'range-after',
        sessionId: SESSION_ID,
        role: 'user',
        data: { parts: [{ type: 'text', text: 'after' }] },
        status: 'success',
        createdAt: 301,
        updatedAt: 301
      }
    ])

    const firstPage = agentSessionMessageService.listCreatedInRangeMetadataPage({ fromMs: 100, toMs: 300, limit: 2 })
    const secondPage = agentSessionMessageService.listCreatedInRangeMetadataPage({
      fromMs: 100,
      toMs: 300,
      limit: 2,
      cursor: firstPage.nextCursor
    })

    expect(firstPage.items.map((message) => message.id)).toEqual(['range-end', 'range-tie-a'])
    expect(secondPage.items.map((message) => message.id)).toEqual(['range-tie-z', 'range-start'])
    expect(secondPage.nextCursor).toBeUndefined()
    for (const metadata of [...firstPage.items, ...secondPage.items]) {
      const entity = agentSessionMessageService.getSessionMessage(metadata.sessionId, metadata.id)
      expect(metadata).not.toHaveProperty('data')
      expect(metadata.createdAt).toBe(entity.createdAt)
      expect(metadata.entityJsonBytes).toBe(Buffer.byteLength(JSON.stringify(entity), 'utf8'))
    }
  })

  it('plans the global keyset range walk without a temporary order-by sort', () => {
    const plan = dbh.sqlite
      .prepare(
        `EXPLAIN QUERY PLAN
         SELECT id
         FROM agent_session_message
         WHERE created_at >= ?
           AND created_at <= ?
           AND (created_at < ? OR (created_at = ? AND id > ?))
         ORDER BY created_at DESC, id ASC
         LIMIT ?`
      )
      .all(100, 300, 200, 200, 'cursor-id', 101) as Array<{ detail: string }>

    expect(
      plan.some(({ detail }) => detail.includes('USING COVERING INDEX agent_session_message_created_at_id_idx'))
    ).toBe(true)
    expect(plan.some(({ detail }) => detail.includes('USE TEMP B-TREE FOR ORDER BY'))).toBe(false)
  })

  it('falls back to the newest page when list pagination receives a malformed cursor', async () => {
    await dbh.db.insert(agentSessionMessageTable).values([
      {
        id: USER_MESSAGE_ID,
        sessionId: SESSION_ID,
        role: 'user',
        data: { parts: [{ type: 'text', text: 'older' }] },
        status: 'success',
        createdAt: 100,
        updatedAt: 100
      },
      {
        id: ASSISTANT_MESSAGE_ID,
        sessionId: SESSION_ID,
        role: 'assistant',
        data: { parts: [{ type: 'text', text: 'newer' }] },
        status: 'success',
        createdAt: 200,
        updatedAt: 200
      }
    ])

    const result = agentSessionMessageService.listSessionMessages(SESSION_ID, {
      cursor: 'not-a-cursor',
      limit: 1
    })

    expect(result.items.map((item) => item.id)).toEqual([ASSISTANT_MESSAGE_ID])
    expect(result.nextCursor).toBe(`200:${ASSISTANT_MESSAGE_ID}`)
  })

  it('anchors list pagination at messageId and continues older pages with cursor', async () => {
    const older = '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d301'
    const middle = '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d302'
    const target = '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d303'
    const newer = '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d304'
    await dbh.db.insert(agentSessionMessageTable).values([
      {
        id: older,
        sessionId: SESSION_ID,
        role: 'assistant',
        data: { parts: [{ type: 'text', text: 'older' }] },
        status: 'success',
        createdAt: 100,
        updatedAt: 100
      },
      {
        id: middle,
        sessionId: SESSION_ID,
        role: 'assistant',
        data: { parts: [{ type: 'text', text: 'middle' }] },
        status: 'success',
        createdAt: 200,
        updatedAt: 200
      },
      {
        id: target,
        sessionId: SESSION_ID,
        role: 'assistant',
        data: { parts: [{ type: 'text', text: 'target' }] },
        status: 'success',
        createdAt: 300,
        updatedAt: 300
      },
      {
        id: newer,
        sessionId: SESSION_ID,
        role: 'assistant',
        data: { parts: [{ type: 'text', text: 'newer' }] },
        status: 'success',
        createdAt: 400,
        updatedAt: 400
      }
    ])

    const firstPage = agentSessionMessageService.listSessionMessages(SESSION_ID, {
      messageId: target,
      limit: 2
    })
    const secondPage = agentSessionMessageService.listSessionMessages(SESSION_ID, {
      messageId: target,
      cursor: firstPage.nextCursor,
      limit: 2
    })

    expect(firstPage.items.map((item) => item.id)).toEqual([target, middle])
    expect(firstPage.nextCursor).toBe(`200:${middle}`)
    expect(secondPage.items.map((item) => item.id)).toEqual([older])
    expect(secondPage.nextCursor).toBeUndefined()
  })

  it('falls back to the newest page when the anchor messageId is outside the requested session', async () => {
    const otherSessionId = 'session-other'
    const otherMessageId = '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d305'
    const newestMessageId = '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d306'
    await seedSession({ id: otherSessionId, name: 'Other Session', orderKey: 'b0' })
    await dbh.db.insert(agentSessionMessageTable).values([
      {
        id: otherMessageId,
        sessionId: otherSessionId,
        role: 'assistant',
        data: { parts: [{ type: 'text', text: 'other' }] },
        status: 'success',
        createdAt: 100,
        updatedAt: 100
      },
      {
        id: newestMessageId,
        sessionId: SESSION_ID,
        role: 'assistant',
        data: { parts: [{ type: 'text', text: 'newest' }] },
        status: 'success',
        createdAt: 200,
        updatedAt: 200
      }
    ])

    const result = agentSessionMessageService.listSessionMessages(SESSION_ID, {
      messageId: otherMessageId
    })

    expect(result.items.map((item) => item.id)).toEqual([newestMessageId])
    expect(result.nextCursor).toBeUndefined()
  })

  it('indexes text parts but excludes reasoning, and keeps the FTS index in sync', async () => {
    // Privacy guard: `reasoning` parts hold the model's hidden chain-of-thought, which the session
    // UI does not render. They must never reach `searchable_text` (which global-search snippets
    // show verbatim) nor the FTS index. Only `text` parts are searchable.
    await dbh.db.insert(agentSessionMessageTable).values({
      id: USER_MESSAGE_ID,
      sessionId: SESSION_ID,
      role: 'user',
      data: {
        parts: [
          { type: 'text', text: 'hello' },
          { type: 'reasoning', text: 'thinking' }
        ]
      },
      status: 'success'
    })

    const [inserted] = await dbh.db
      .select()
      .from(agentSessionMessageTable)
      .where(eq(agentSessionMessageTable.id, USER_MESSAGE_ID))
    expect(inserted.searchableText).toBe('hello')

    const helloMatches = dbh.sqlite
      .prepare(
        `SELECT m.id
            FROM agent_session_message m
            JOIN agent_session_message_fts fts ON m.fts_rowid = fts.rowid
            WHERE agent_session_message_fts MATCH ?`
      )
      .all('hello') as Array<{ id: string }>
    expect(helloMatches.map((row) => String(row.id))).toEqual([USER_MESSAGE_ID])

    const thinkingMatches = dbh.sqlite
      .prepare(
        `SELECT m.id
            FROM agent_session_message m
            JOIN agent_session_message_fts fts ON m.fts_rowid = fts.rowid
            WHERE agent_session_message_fts MATCH ?`
      )
      .all('thinking') as Array<{ id: string }>
    expect(thinkingMatches).toHaveLength(0)

    await dbh.db
      .update(agentSessionMessageTable)
      .set({ data: { parts: [{ type: 'text', text: 'updated target' }] } })
      .where(eq(agentSessionMessageTable.id, USER_MESSAGE_ID))

    const staleMatches = dbh.sqlite
      .prepare(
        `SELECT m.id
            FROM agent_session_message m
            JOIN agent_session_message_fts fts ON m.fts_rowid = fts.rowid
            WHERE agent_session_message_fts MATCH ?`
      )
      .all('thinking') as Array<{ id: string }>
    const targetMatches = dbh.sqlite
      .prepare(
        `SELECT m.id
            FROM agent_session_message m
            JOIN agent_session_message_fts fts ON m.fts_rowid = fts.rowid
            WHERE agent_session_message_fts MATCH ?`
      )
      .all('target') as Array<{ id: string }>

    expect(staleMatches).toHaveLength(0)
    expect(targetMatches.map((row) => String(row.id))).toEqual([USER_MESSAGE_ID])
  })

  it('searches session message parts text', async () => {
    await dbh.db.insert(agentTable).values({
      id: 'agent-search',
      type: 'claude-code',
      name: 'Search Agent',
      instructions: 'Search instructions',
      model: null,
      orderKey: 'a0'
    })
    await seedSession({
      id: 'session-search',
      agentId: 'agent-search',
      name: 'Session Search',
      orderKey: 's0',
      createdAt: 150,
      updatedAt: 150
    })
    await dbh.db.insert(agentSessionMessageTable).values({
      id: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d101',
      sessionId: 'session-search',
      role: 'assistant',
      data: { parts: [{ type: 'text', text: 'The session message has a unique needle.' }] },
      status: 'success',
      createdAt: 300,
      updatedAt: 300
    })

    const result = agentSessionMessageService.search({ q: 'needle' })

    expect(result.items).toEqual([
      expect.objectContaining({
        messageId: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d101',
        sessionId: 'session-search',
        sessionName: 'Session Search',
        agentId: 'agent-search',
        agentName: 'Search Agent',
        role: 'assistant'
      })
    ])
    expect(result.items[0].snippet).toContain('unique needle')
  })

  it('matches extracted text instead of serialized JSON escapes', async () => {
    await seedSession({
      id: 'session-escaped',
      name: 'Session Escaped',
      orderKey: 'se0'
    })
    await dbh.db.insert(agentSessionMessageTable).values({
      id: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d102',
      sessionId: 'session-escaped',
      role: 'assistant',
      data: { parts: [{ type: 'text', text: 'line one\nline two' }] },
      status: 'success',
      createdAt: 300,
      updatedAt: 300
    })

    const result = agentSessionMessageService.search({
      q: '"line one\nline two"'
    })

    expect(result.items.map((item) => item.messageId)).toEqual(['018f6ed6-73b8-7f40-8d0d-9bb2f8f1d102'])
  })

  it('defaults session message search to substring matching', async () => {
    await seedSession({
      id: 'session-substring-default',
      name: 'Session Substring Default',
      orderKey: 'ssd0'
    })
    await dbh.db.insert(agentSessionMessageTable).values({
      id: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d1aa',
      sessionId: 'session-substring-default',
      role: 'assistant',
      data: { parts: [{ type: 'text', text: 'abcneedledef is embedded in a larger token.' }] },
      status: 'success',
      createdAt: 300,
      updatedAt: 300
    })

    const result = agentSessionMessageService.search({ q: 'needle' })

    expect(result.items.map((item) => item.messageId)).toEqual(['018f6ed6-73b8-7f40-8d0d-9bb2f8f1d1aa'])
  })

  it('requires all search terms to match a session message', async () => {
    await seedSession({
      id: 'session-search-and',
      name: 'Session Search And',
      orderKey: 'ssa0'
    })
    await dbh.db.insert(agentSessionMessageTable).values([
      {
        id: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d1ba',
        sessionId: 'session-search-and',
        role: 'assistant',
        data: { parts: [{ type: 'text', text: 'alpha needle appear together.' }] },
        status: 'success',
        createdAt: 100,
        updatedAt: 100
      },
      {
        id: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d1bb',
        sessionId: 'session-search-and',
        role: 'assistant',
        data: { parts: [{ type: 'text', text: 'needle appears without the other term.' }] },
        status: 'success',
        createdAt: 200,
        updatedAt: 200
      }
    ])

    const result = agentSessionMessageService.search({ q: 'alpha needle' })

    expect(result.items.map((item) => item.messageId)).toEqual(['018f6ed6-73b8-7f40-8d0d-9bb2f8f1d1ba'])
  })

  it('ranks Agent-tool search by BM25 instead of requiring every term', async () => {
    await seedSession({ id: 'session-ranked', name: 'Session Ranked', orderKey: 'sr0' })
    await seedSession({ id: 'session-ranked-secondary', name: 'Session Ranked Secondary', orderKey: 'sr1' })
    await dbh.db.insert(agentSessionMessageTable).values([
      {
        id: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d1ca',
        sessionId: 'session-ranked-secondary',
        role: 'assistant',
        data: { parts: [{ type: 'text', text: 'hyperfine benchmark setup' }] },
        status: 'success',
        createdAt: 300,
        updatedAt: 300
      },
      {
        id: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d1cb',
        sessionId: 'session-ranked',
        role: 'assistant',
        data: { parts: [{ type: 'text', text: 'install and verify hyperfine with cowsay' }] },
        status: 'success',
        createdAt: 100,
        updatedAt: 100
      }
    ])

    const result = agentSessionMessageService.searchRanked({ q: 'hyperfine cowsay', limit: 2 })

    expect(result.map((item) => item.messageId)).toEqual([
      '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d1cb',
      '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d1ca'
    ])
  })

  it('applies ranked-search limit to distinct Sessions', async () => {
    await seedSession({ id: 'session-ranked-frequent', name: 'Ranked Frequent', orderKey: 'srf0' })
    await seedSession({ id: 'session-ranked-diverse', name: 'Ranked Diverse', orderKey: 'srd0' })
    await dbh.db.insert(agentSessionMessageTable).values([
      ...Array.from({ length: 25 }, (_, index) => ({
        id: `018f6ed6-73b8-7f40-8d0d-9bb2f8f1${String(index).padStart(4, '0')}`,
        sessionId: 'session-ranked-frequent',
        role: 'assistant' as const,
        data: { parts: [{ type: 'text' as const, text: 'needle' }] },
        status: 'success' as const,
        createdAt: 500 - index,
        updatedAt: 500 - index
      })),
      {
        id: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d1cf',
        sessionId: 'session-ranked-diverse',
        role: 'assistant',
        data: { parts: [{ type: 'text', text: 'needle appears in another Session' }] },
        status: 'success',
        createdAt: 100,
        updatedAt: 100
      }
    ])

    const result = agentSessionMessageService.searchRanked({ q: 'needle', limit: 2 })

    expect(result.map((item) => item.sessionId)).toEqual(['session-ranked-frequent', 'session-ranked-diverse'])
  })

  it('bounds synchronous ranked-search evidence scanning', async () => {
    await seedSession({ id: 'session-ranked-overflow', name: 'Ranked Overflow', orderKey: 'sro0' })
    await seedSession({ id: 'session-ranked-after-cap', name: 'Ranked After Cap', orderKey: 'srac0' })
    await dbh.db.insert(agentSessionMessageTable).values([
      ...Array.from({ length: 400 }, (_, index) => ({
        id: `ranked-overflow-${String(index).padStart(4, '0')}`,
        sessionId: 'session-ranked-overflow',
        role: 'assistant' as const,
        data: { parts: [{ type: 'text' as const, text: 'boundedneedle' }] },
        status: 'success' as const,
        createdAt: 1_000 - index,
        updatedAt: 1_000 - index
      })),
      {
        id: 'ranked-after-cap',
        sessionId: 'session-ranked-after-cap',
        role: 'assistant',
        data: { parts: [{ type: 'text', text: 'boundedneedle' }] },
        status: 'success',
        createdAt: 1,
        updatedAt: 1
      }
    ])

    expect(
      agentSessionMessageService.searchRanked({ q: 'boundedneedle', limit: 2 }).map((item) => item.sessionId)
    ).toEqual(['session-ranked-overflow'])
  })

  it('applies the Agent filter before the ranked-search limit', async () => {
    await seedAgent('agent-ranked-a', 'Ranked A')
    await seedAgent('agent-ranked-b', 'Ranked B')
    await seedSession({ id: 'session-ranked-a', agentId: 'agent-ranked-a', name: 'Ranked A', orderKey: 'sra0' })
    await seedSession({ id: 'session-ranked-b', agentId: 'agent-ranked-b', name: 'Ranked B', orderKey: 'srb0' })
    await dbh.db.insert(agentSessionMessageTable).values([
      {
        id: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d1cc',
        sessionId: 'session-ranked-a',
        role: 'assistant',
        data: { parts: [{ type: 'text', text: 'needle from another Agent' }] },
        status: 'success',
        createdAt: 300,
        updatedAt: 300
      },
      {
        id: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d1cd',
        sessionId: 'session-ranked-b',
        role: 'assistant',
        data: { parts: [{ type: 'text', text: 'needle from the requested Agent' }] },
        status: 'success',
        createdAt: 100,
        updatedAt: 100
      }
    ])

    const result = agentSessionMessageService.searchRanked({ q: 'needle', agentId: 'agent-ranked-b', limit: 1 })

    expect(result.map((item) => item.messageId)).toEqual(['018f6ed6-73b8-7f40-8d0d-9bb2f8f1d1cd'])
  })

  it('supports exact identifiers, short CJK fallback, and empty ranked results', async () => {
    await seedSession({ id: 'session-ranked-shapes', name: 'Ranked Shapes', orderKey: 'srs0' })
    await dbh.db.insert(agentSessionMessageTable).values({
      id: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d1ce',
      sessionId: 'session-ranked-shapes',
      role: 'assistant',
      data: { parts: [{ type: 'text', text: 'TEST_ECHO_42 今天天气很好' }] },
      status: 'success',
      createdAt: 100,
      updatedAt: 100
    })

    expect(agentSessionMessageService.searchRanked({ q: 'TEST_ECHO_42' }).map((item) => item.messageId)).toEqual([
      '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d1ce'
    ])
    expect(agentSessionMessageService.searchRanked({ q: '天气' }).map((item) => item.messageId)).toEqual([
      '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d1ce'
    ])
    expect(agentSessionMessageService.searchRanked({ q: '全部不存在xyzzy' })).toEqual([])
  })

  it('deduplicates and caps pure-LIKE fallback terms below SQLite expression depth', async () => {
    await seedSession({ id: 'session-ranked-fallback-cap', name: 'Fallback Cap', orderKey: 'srfc0' })
    const uniqueShortTerms = Array.from({ length: 512 }, (_, index) => String.fromCodePoint(0x400 + index))
      .filter((term) => /^\p{L}$/u.test(term))
      .slice(0, 129)
    expect(uniqueShortTerms).toHaveLength(129)
    await dbh.db.insert(agentSessionMessageTable).values({
      id: 'ranked-fallback-cap',
      sessionId: 'session-ranked-fallback-cap',
      role: 'assistant',
      data: { parts: [{ type: 'text', text: uniqueShortTerms.slice(0, 128).join(' ') }] },
      status: 'success',
      createdAt: 100,
      updatedAt: 100
    })

    expect(() =>
      agentSessionMessageService.searchRanked({ q: `${'a '.repeat(993)}${uniqueShortTerms[0]}` })
    ).not.toThrow()
    expect(
      agentSessionMessageService.searchRanked({ q: uniqueShortTerms.join(' ') }).map((item) => item.messageId)
    ).toEqual(['ranked-fallback-cap'])
  })

  it('treats LIKE wildcards as literal session-message search text after FTS prefiltering', async () => {
    await seedSession({
      id: 'session-search-literal',
      name: 'Session Search Literal',
      orderKey: 'ssl0'
    })
    await dbh.db.insert(agentSessionMessageTable).values([
      {
        id: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d1bc',
        sessionId: 'session-search-literal',
        role: 'assistant',
        data: { parts: [{ type: 'text', text: 'Save 50% off today.' }] },
        status: 'success',
        createdAt: 100,
        updatedAt: 100
      },
      {
        id: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d1bd',
        sessionId: 'session-search-literal',
        role: 'assistant',
        data: { parts: [{ type: 'text', text: 'Save 50X off today.' }] },
        status: 'success',
        createdAt: 200,
        updatedAt: 200
      },
      {
        id: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d1be',
        sessionId: 'session-search-literal',
        role: 'assistant',
        data: { parts: [{ type: 'text', text: 'Save 50_ off today.' }] },
        status: 'success',
        createdAt: 300,
        updatedAt: 300
      }
    ])

    const percentResult = agentSessionMessageService.search({ q: '50%' })
    const underscoreResult = agentSessionMessageService.search({ q: '50_' })

    expect(percentResult.items.map((item) => item.messageId)).toEqual(['018f6ed6-73b8-7f40-8d0d-9bb2f8f1d1bc'])
    expect(underscoreResult.items.map((item) => item.messageId)).toEqual(['018f6ed6-73b8-7f40-8d0d-9bb2f8f1d1be'])
  })

  it('uses the session message FTS index as the search candidate source', async () => {
    await seedSession({
      id: 'session-fts-candidate',
      name: 'Session FTS Candidate',
      orderKey: 'sfc0'
    })
    await dbh.db.insert(agentSessionMessageTable).values({
      id: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d1ab',
      sessionId: 'session-fts-candidate',
      role: 'assistant',
      data: { parts: [{ type: 'text', text: 'needle exists in the base session message text.' }] },
      status: 'success',
      createdAt: 300,
      updatedAt: 300
    })

    const ftsRow = dbh.sqlite
      .prepare('SELECT fts_rowid, searchable_text FROM agent_session_message WHERE id = ?')
      .get('018f6ed6-73b8-7f40-8d0d-9bb2f8f1d1ab') as { fts_rowid: number; searchable_text: string }
    dbh.sqlite
      .prepare(
        `INSERT INTO agent_session_message_fts(agent_session_message_fts, rowid, searchable_text)
            VALUES ('delete', ?, ?)`
      )
      .run(ftsRow.fts_rowid, ftsRow.searchable_text)

    let result: Awaited<ReturnType<typeof agentSessionMessageService.search>>
    try {
      result = agentSessionMessageService.search({ q: 'needle' })
    } finally {
      dbh.sqlite.prepare(`INSERT INTO agent_session_message_fts(agent_session_message_fts) VALUES ('rebuild')`).run()
    }

    expect(result.items).toEqual([])
  })

  it('filters session message search by session id', async () => {
    await seedSessions([
      {
        id: 'session-source-filter',
        name: 'Session Source Filter',
        orderKey: 'sf0'
      },
      {
        id: 'session-source-other',
        name: 'Session Source Other',
        orderKey: 'sf1'
      }
    ])
    await dbh.db.insert(agentSessionMessageTable).values([
      {
        id: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d103',
        sessionId: 'session-source-filter',
        role: 'assistant',
        data: { parts: [{ type: 'text', text: 'session-only needle' }] },
        status: 'success',
        createdAt: 300,
        updatedAt: 300
      },
      {
        id: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d104',
        sessionId: 'session-source-other',
        role: 'assistant',
        data: { parts: [{ type: 'text', text: 'other session needle' }] },
        status: 'success',
        createdAt: 200,
        updatedAt: 200
      }
    ])

    const result = agentSessionMessageService.search({
      q: 'needle',
      sessionId: 'session-source-filter'
    })

    expect(result.items.map((item) => item.messageId)).toEqual(['018f6ed6-73b8-7f40-8d0d-9bb2f8f1d103'])
  })

  it('filters session message search by createdAtFrom', async () => {
    await seedSession({
      id: 'session-created-filter',
      name: 'Session Created Filter',
      orderKey: 'sc0'
    })
    await dbh.db.insert(agentSessionMessageTable).values([
      {
        id: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d108',
        sessionId: 'session-created-filter',
        role: 'assistant',
        data: { parts: [{ type: 'text', text: 'older session needle' }] },
        status: 'success',
        createdAt: 100,
        updatedAt: 500
      },
      {
        id: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d109',
        sessionId: 'session-created-filter',
        role: 'assistant',
        data: { parts: [{ type: 'text', text: 'newer session needle' }] },
        status: 'success',
        createdAt: 300,
        updatedAt: 300
      }
    ])

    const result = agentSessionMessageService.search({
      q: 'needle',
      createdAtFrom: '1970-01-01T00:00:00.250Z'
    })

    expect(result.items.map((item) => item.messageId)).toEqual(['018f6ed6-73b8-7f40-8d0d-9bb2f8f1d109'])
  })

  it('paginates search with message ids as row-id cursors', async () => {
    await seedSession({
      id: 'session-page',
      name: 'Session Page',
      orderKey: 'sp0'
    })
    await dbh.db.insert(agentSessionMessageTable).values([
      {
        id: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d105',
        sessionId: 'session-page',
        role: 'assistant',
        data: { parts: [{ type: 'text', text: 'needle oldest' }] },
        status: 'success',
        createdAt: 100,
        updatedAt: 100
      },
      {
        id: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d106',
        sessionId: 'session-page',
        role: 'assistant',
        data: { parts: [{ type: 'text', text: 'needle middle' }] },
        status: 'success',
        createdAt: 200,
        updatedAt: 200
      },
      {
        id: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d107',
        sessionId: 'session-page',
        role: 'assistant',
        data: { parts: [{ type: 'text', text: 'needle newest' }] },
        status: 'success',
        createdAt: 300,
        updatedAt: 300
      }
    ])

    const firstPage = agentSessionMessageService.search({
      q: 'needle',
      sessionId: 'session-page',
      limit: 2
    })
    const secondPage = agentSessionMessageService.search({
      q: 'needle',
      sessionId: 'session-page',
      limit: 2,
      cursor: firstPage.nextCursor
    })

    expect(firstPage.items.map((item) => item.messageId)).toEqual([
      '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d107',
      '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d106'
    ])
    expect(firstPage.nextCursor).toBe('200:018f6ed6-73b8-7f40-8d0d-9bb2f8f1d106')
    expect(secondPage.items.map((item) => item.messageId)).toEqual(['018f6ed6-73b8-7f40-8d0d-9bb2f8f1d105'])
    expect(secondPage.nextCursor).toBeUndefined()
  })

  it('uses session message id as the search cursor tiebreaker when createdAt values match', async () => {
    await seedSession({
      id: 'session-page-tie',
      name: 'Session Page Tie',
      orderKey: 'spt0'
    })
    await dbh.db.insert(agentSessionMessageTable).values([
      {
        id: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d205',
        sessionId: 'session-page-tie',
        role: 'assistant',
        data: { parts: [{ type: 'text', text: 'needle tie oldest' }] },
        status: 'success',
        createdAt: 100,
        updatedAt: 100
      },
      {
        id: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d206',
        sessionId: 'session-page-tie',
        role: 'assistant',
        data: { parts: [{ type: 'text', text: 'needle tie middle' }] },
        status: 'success',
        createdAt: 100,
        updatedAt: 100
      },
      {
        id: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d207',
        sessionId: 'session-page-tie',
        role: 'assistant',
        data: { parts: [{ type: 'text', text: 'needle tie newest' }] },
        status: 'success',
        createdAt: 100,
        updatedAt: 100
      }
    ])

    const firstPage = agentSessionMessageService.search({
      q: 'needle',
      sessionId: 'session-page-tie',
      limit: 2
    })
    const secondPage = agentSessionMessageService.search({
      q: 'needle',
      sessionId: 'session-page-tie',
      limit: 2,
      cursor: firstPage.nextCursor
    })

    expect(firstPage.items.map((item) => item.messageId)).toEqual([
      '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d207',
      '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d206'
    ])
    expect(firstPage.nextCursor).toBe('100:018f6ed6-73b8-7f40-8d0d-9bb2f8f1d206')
    expect(secondPage.items.map((item) => item.messageId)).toEqual(['018f6ed6-73b8-7f40-8d0d-9bb2f8f1d205'])
    expect(secondPage.nextCursor).toBeUndefined()
  })

  it('rejects malformed session message search cursors', () => {
    let malformedError: unknown
    try {
      agentSessionMessageService.search({ q: 'needle', cursor: 'not-a-cursor' })
    } catch (error) {
      malformedError = error
    }
    expect(malformedError).toMatchObject({ code: 'VALIDATION_ERROR' })

    let nonNumericKeyError: unknown
    try {
      agentSessionMessageService.search({ q: 'needle', cursor: 'abc:018f6ed6-73b8-7f40-8d0d-9bb2f8f1d206' })
    } catch (error) {
      nonNumericKeyError = error
    }
    expect(nonNumericKeyError).toMatchObject({ code: 'VALIDATION_ERROR' })
  })

  describe('saveMessage — record projection ownership', () => {
    const USAGE_MESSAGE_ID = '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d301'
    const USAGE_AGENT_ID = 'agent-usage'

    beforeEach(() => {
      dbh.db
        .insert(agentTable)
        .values({
          id: USAGE_AGENT_ID,
          type: 'claude_code',
          name: 'Usage Agent',
          instructions: '',
          model: null,
          orderKey: 'a0'
        })
        .run()
      dbh.db
        .update(agentSessionTable)
        .set({ agentId: USAGE_AGENT_ID })
        .where(eq(agentSessionTable.id, SESSION_ID))
        .run()
    })

    function seedModel() {
      dbh.db.insert(userProviderTable).values({ providerId: 'anthropic', name: 'Anthropic', orderKey: 'p0' }).run()
      dbh.db
        .insert(userModelTable)
        .values({
          id: 'anthropic::claude-sonnet',
          providerId: 'anthropic',
          modelId: 'claude-sonnet',
          presetModelId: 'claude-sonnet',
          name: 'claude-sonnet',
          isEnabled: true,
          isHidden: false,
          orderKey: 'm0'
        })
        .run()
    }

    it('persists runtime timing without turning it into a usage record', async () => {
      seedModel()

      agentSessionMessageService.saveMessage({
        sessionId: SESSION_ID,
        runtimeStats: {
          runtimeTiming: {
            startedAt: 1_000,
            completedAt: 2_000,
            spans: []
          }
        },
        message: {
          id: USAGE_MESSAGE_ID,
          role: 'assistant',
          status: 'success',
          data: { parts: [] },
          modelId: 'anthropic::claude-sonnet'
        }
      })

      expect(dbh.db.select().from(aiUsageRecordTable).all()).toHaveLength(0)
      expect(
        dbh.db
          .select({ stats: agentSessionMessageTable.stats })
          .from(agentSessionMessageTable)
          .where(eq(agentSessionMessageTable.id, USAGE_MESSAGE_ID))
          .get()?.stats
      ).toEqual({
        requestCount: 0,
        estimatedRequestCount: 0,
        unpricedRequestCount: 0,
        costs: [],
        runtimeTiming: {
          startedAt: 1_000,
          completedAt: 2_000,
          spans: []
        }
      })
    })

    it('needs no route-owner flag to suppress stats-less message persistence', async () => {
      seedModel()

      agentSessionMessageService.saveMessage({
        sessionId: SESSION_ID,
        message: {
          id: USAGE_MESSAGE_ID,
          role: 'assistant',
          status: 'success',
          data: { parts: [] },
          modelId: 'anthropic::claude-sonnet'
        }
      })

      expect(dbh.db.select().from(aiUsageRecordTable).all()).toHaveLength(0)
    })

    it('projects a provider-call record that arrived before the agent message row', async () => {
      seedModel()

      aiUsageRecordService.recordInvocation({
        requestId: 'gateway-provider-call',
        context: createAiUsageCaptureContext({
          providerId: 'anthropic',
          providerName: 'Anthropic',
          modelId: 'claude-sonnet',
          modelName: 'Claude Sonnet',
          credentialReceipt: {
            attribution: 'explicit',
            id: 'key-primary',
            label: 'Primary',
            masked: 'sk-a****aaaa'
          },
          source: { type: 'agent', id: USAGE_AGENT_ID, name: 'Usage Agent', icon: null },
          messageRef: { kind: 'agent-session', id: USAGE_MESSAGE_ID }
        }),
        modality: 'language',
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        completedAt: 1_000
      })
      agentSessionMessageService.saveMessage({
        sessionId: SESSION_ID,
        message: {
          id: USAGE_MESSAGE_ID,
          role: 'assistant',
          status: 'success',
          data: { parts: [] },
          modelId: 'anthropic::claude-sonnet'
        }
      })

      const rows = dbh.db.select().from(aiUsageRecordTable).all()
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        requestId: 'gateway-provider-call',
        totalTokens: 15,
        apiKeyId: 'key-primary',
        sourceType: 'agent',
        sourceId: USAGE_AGENT_ID
      })
      expect(
        dbh.db
          .select({ stats: agentSessionMessageTable.stats })
          .from(agentSessionMessageTable)
          .where(eq(agentSessionMessageTable.id, USAGE_MESSAGE_ID))
          .get()?.stats
      ).toMatchObject({ inputTokens: 10, outputTokens: 5, totalTokens: 15, requestCount: 1 })
    })

    it('does not infer usage from a persisted model snapshot after the model row is deleted', async () => {
      seedModel()
      const messageSnapshot = {
        id: 'agent-at-request-time',
        name: 'Agent at request time',
        model: {
          id: 'claude-sonnet',
          name: 'Claude Sonnet',
          provider: 'anthropic'
        }
      }

      agentSessionMessageService.saveMessage({
        sessionId: SESSION_ID,
        message: {
          id: USAGE_MESSAGE_ID,
          role: 'assistant',
          status: 'pending',
          data: { parts: [] },
          modelId: 'anthropic::claude-sonnet',
          messageSnapshot
        }
      })
      dbh.db.delete(userModelTable).where(eq(userModelTable.id, 'anthropic::claude-sonnet')).run()
      expect(
        dbh.db
          .select({ modelId: agentSessionMessageTable.modelId })
          .from(agentSessionMessageTable)
          .where(eq(agentSessionMessageTable.id, USAGE_MESSAGE_ID))
          .get()
      ).toEqual({ modelId: null })

      agentSessionMessageService.saveMessage({
        sessionId: SESSION_ID,
        message: {
          id: USAGE_MESSAGE_ID,
          role: 'assistant',
          status: 'success',
          data: { parts: [] }
        }
      })

      expect(dbh.db.select().from(aiUsageRecordTable).all()).toHaveLength(0)
    })

    it('does not record user messages or stats-less assistant messages', async () => {
      seedModel()

      agentSessionMessageService.saveMessage({
        sessionId: SESSION_ID,
        message: {
          id: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d302',
          role: 'user',
          status: 'success',
          data: { parts: [] }
        }
      })
      agentSessionMessageService.saveMessage({
        sessionId: SESSION_ID,
        message: {
          id: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d303',
          role: 'assistant',
          status: 'success',
          data: { parts: [] },
          modelId: 'anthropic::claude-sonnet'
        }
      })

      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(dbh.db.select().from(aiUsageRecordTable).all()).toHaveLength(0)
    })
  })
})
