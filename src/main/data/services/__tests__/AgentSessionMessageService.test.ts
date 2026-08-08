import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { aiUsageRecordTable } from '@data/db/schemas/aiUsageRecord'
import { fileEntryTable } from '@data/db/schemas/file'
import { agentSessionMessageFileRefTable } from '@data/db/schemas/fileRelations'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import type { AgentSessionDeliveryRoutingError } from '@data/services/AgentSessionMessageService'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
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
    await dbh.db.insert(agentSessionTable).values({ ...values, workspaceId })
  }

  async function seedSessions(rows: Array<Omit<AgentSessionInsert, 'workspaceId'> & { workspaceId?: string }>) {
    for (const row of rows) {
      await seedSession(row)
    }
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
    expect(agentSessionMessageService.hasSessionMessages('session-2')).toBe(false)
  })

  describe('cross-session delivery', () => {
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
        content: 'same agent work',
        mode: 'auto'
      })
      const crossAgent = agentSessionMessageService.acceptSessionDelivery({
        senderAgentId: 'agent-a',
        senderSessionId: 'sender',
        receiverSessionId: 'cross-target',
        content: 'cross agent work',
        mode: 'queue'
      })

      expect(sameAgent.delivery).toMatchObject({
        sender: { agentId: 'agent-a', sessionId: 'sender' },
        receiver: { agentId: 'agent-a', sessionId: 'same-target' },
        replyTo: { agentId: 'agent-a', sessionId: 'sender' },
        status: 'accepted'
      })
      expect(crossAgent.delivery).toMatchObject({
        receiver: { agentId: 'agent-b', sessionId: 'cross-target' },
        mode: 'queue',
        status: 'accepted'
      })
      expect(agentSessionMessageService.listRecoverableSessionDeliveries().map((message) => message.id)).toEqual([
        sameAgent.id,
        crossAgent.id
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
          expectsReply: true,
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
          content: 'forged',
          mode: 'auto'
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
          content: 'work',
          mode: 'auto'
        })

      expect(() => send('missing')).toThrowError(expect.objectContaining({ code: 'TARGET_SESSION_NOT_FOUND' }))
      expect(() => send('orphan')).toThrowError(expect.objectContaining({ code: 'TARGET_SESSION_ORPHANED' }))
      expect(() => send('deleted-target')).toThrowError(expect.objectContaining({ code: 'TARGET_AGENT_DELETED' }))
    })

    it('keeps queued and delivering rows recoverable until terminal consumption', async () => {
      await seedAgent('agent-a', 'Agent A')
      await seedSession({ id: 'sender', agentId: 'agent-a', name: 'Sender', orderKey: 'b0' })
      await seedSession({ id: 'target', agentId: 'agent-a', name: 'Target', orderKey: 'b1' })
      const accepted = agentSessionMessageService.acceptSessionDelivery({
        senderAgentId: 'agent-a',
        senderSessionId: 'sender',
        receiverSessionId: 'target',
        content: 'durable work',
        mode: 'auto'
      })

      agentSessionMessageService.updateSessionDeliveryStatus('target', accepted.id, 'queued')
      agentSessionMessageService.updateSessionDeliveryStatus('target', accepted.id, 'delivering')
      expect(agentSessionMessageService.listRecoverableSessionDeliveries()).toHaveLength(1)

      const consumed = agentSessionMessageService.updateSessionDeliveryStatus('target', accepted.id, 'consumed')
      expect(consumed?.delivery).toMatchObject({ status: 'consumed', consumedAt: expect.any(String) })
      expect(agentSessionMessageService.listRecoverableSessionDeliveries()).toEqual([])
    })
  })

  describe('findPendingAssistantMessageIds + markMessagesError (boot reconcile)', () => {
    it('finds only pending assistant rows and resolves them to error', async () => {
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

      expect(agentSessionMessageService.findPendingAssistantMessageIds()).toEqual([PENDING])

      agentSessionMessageService.markMessagesError([PENDING])
      expect(agentSessionMessageService.findPendingAssistantMessageIds()).toEqual([])
      const [row] = await dbh.db.select().from(agentSessionMessageTable).where(eq(agentSessionMessageTable.id, PENDING))
      expect(row.status).toBe('error')
    })
  })

  it('atomically settles a persisted background tool approval with the user-updated input', () => {
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

  it('keeps createdAt stable when updating an existing message', async () => {
    vi.spyOn(Date, 'now').mockReturnValueOnce(1_700_000_000_000).mockReturnValueOnce(1_700_000_000_500)

    const created = agentSessionMessageService.saveMessage({
      sessionId: SESSION_ID,
      message: {
        id: USER_MESSAGE_ID,
        role: 'user',
        data: { parts: [{ type: 'text', text: 'hello' }] }
      }
    })
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
    expect(updated.createdAt).toBe(created.createdAt)
    expect(updated.updatedAt).toBe('2023-11-14T22:13:20.500Z')
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

    expect(notifyDataApiDataChangeMock).toHaveBeenLastCalledWith([
      {
        endpoint: '/agent-sessions/:sessionId/messages',
        kind: 'membership',
        entityIds: [USER_MESSAGE_ID]
      }
    ])

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
        entityIds: [ASSISTANT_MESSAGE_ID]
      }
    ])
  })

  it('uses one timestamp for a batch of newly saved messages', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_001_000)

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
    expect(rows.map((row) => row.updatedAt)).toEqual([1_700_000_001_000, 1_700_000_001_000])
    expect(session.updatedAt).toBe(1_700_000_001_000)
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

  it('keeps searchable_text and FTS index in sync from message data', async () => {
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
    expect(inserted.searchableText).toBe('hello\nthinking')

    const thinkingMatches = dbh.sqlite
      .prepare(
        `SELECT m.id
            FROM agent_session_message m
            JOIN agent_session_message_fts fts ON m.fts_rowid = fts.rowid
            WHERE agent_session_message_fts MATCH ?`
      )
      .all('thinking') as Array<{ id: string }>
    expect(thinkingMatches.map((row) => String(row.id))).toEqual([USER_MESSAGE_ID])

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
