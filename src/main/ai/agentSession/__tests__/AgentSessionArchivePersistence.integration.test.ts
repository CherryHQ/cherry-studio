import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { BaseService } from '@main/core/lifecycle/BaseService'

const mocks = vi.hoisted(() => ({
  hasUnsettledTopicWork: vi.fn(),
  isSessionBusy: vi.fn(),
  closeSession: vi.fn()
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    AiStreamManager: {
      isWriteQuiesced: false,
      withDispatchLock: (_topicId: string, operation: () => Promise<unknown>) => operation(),
      hasUnsettledTopicWork: mocks.hasUnsettledTopicWork
    },
    AgentSessionRuntimeService: {
      isSessionBusy: mocks.isSessionBusy,
      closeSession: mocks.closeSession
    }
  } as Parameters<typeof mockApplicationFactory>[0])
})

const { AgentLifecycleService } = await import('../../agents/AgentLifecycleService')
const { AgentSessionMessageBackend } = await import('../persistence/AgentSessionMessageBackend')

const AGENT_ID = 'agent-archive-persistence'
const WORKSPACE_ID = 'workspace-archive-persistence'
const SESSION_ID = 'session-archive-persistence'
const ASSISTANT_MESSAGE_ID = '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d100'

describe('Agent Session archive persistence', () => {
  const dbh = setupTestDatabase()

  beforeEach(async () => {
    BaseService.resetInstances()
    vi.clearAllMocks()
    mocks.hasUnsettledTopicWork.mockReturnValue(true)
    mocks.isSessionBusy.mockReturnValue(false)
    mocks.closeSession.mockResolvedValue(undefined)

    await dbh.db.insert(agentTable).values({
      id: AGENT_ID,
      type: 'claude-code',
      name: 'Archive persistence Agent',
      instructions: 'Test instructions',
      orderKey: 'a0'
    })
    await dbh.db.insert(agentWorkspaceTable).values({
      id: WORKSPACE_ID,
      name: 'Archive persistence workspace',
      path: '/tmp/archive-persistence-workspace',
      type: 'user',
      orderKey: 'a0'
    })
    await dbh.db.insert(agentSessionTable).values({
      id: SESSION_ID,
      agentId: AGENT_ID,
      name: 'Archive persistence Session',
      workspaceId: WORKSPACE_ID,
      orderKey: 'a0'
    })
    agentSessionMessageService.saveMessage({
      sessionId: SESSION_ID,
      message: {
        id: ASSISTANT_MESSAGE_ID,
        role: 'assistant',
        status: 'pending',
        data: { parts: [] }
      }
    })
  })

  it('preserves the terminal assistant reply when archive is retried after generation settles', async () => {
    const service = new AgentLifecycleService()

    await expect(service.archiveSessions([SESSION_ID])).rejects.toMatchObject({
      name: 'AgentSessionArchiveBusyError',
      sessionIds: [SESSION_ID]
    })
    expect(agentSessionService.getById(SESSION_ID).id).toBe(SESSION_ID)

    mocks.hasUnsettledTopicWork.mockReturnValue(false)
    new AgentSessionMessageBackend({
      sessionId: SESSION_ID,
      assistantMessageId: ASSISTANT_MESSAGE_ID
    }).persistAssistant({
      status: 'success',
      finalMessage: {
        id: ASSISTANT_MESSAGE_ID,
        role: 'assistant',
        parts: [{ type: 'text', text: 'Reply persisted before archive' }]
      }
    })

    await expect(service.archiveSessions([SESSION_ID])).resolves.toEqual({ deletedIds: [SESSION_ID] })
    await service.restoreSession(SESSION_ID)

    expect(agentSessionMessageService.getSessionMessage(SESSION_ID, ASSISTANT_MESSAGE_ID)).toMatchObject({
      status: 'success',
      data: { parts: [{ type: 'text', text: 'Reply persisted before archive' }] }
    })
  })

  it.each(['stream', 'runtime'])('refuses direct permanent deletion while %s work is unsettled', async (busy) => {
    mocks.hasUnsettledTopicWork.mockReturnValue(busy === 'stream')
    mocks.isSessionBusy.mockReturnValue(busy === 'runtime')
    const service = new AgentLifecycleService()
    await expect(service.deleteActiveSessionsPermanently([SESSION_ID])).rejects.toMatchObject({
      name: 'AgentSessionArchiveBusyError'
    })
    expect(agentSessionService.getById(SESSION_ID).id).toBe(SESSION_ID)
    expect(agentSessionMessageService.getSessionMessage(SESSION_ID, ASSISTANT_MESSAGE_ID).status).toBe('pending')
  })

  it('permanently deletes an idle active Session and its messages without deleting the user workspace', async () => {
    mocks.hasUnsettledTopicWork.mockReturnValue(false)
    const service = new AgentLifecycleService()
    await expect(service.deleteActiveSessionsPermanently([SESSION_ID])).resolves.toEqual({ deletedIds: [SESSION_ID] })
    expect(dbh.db.select().from(agentSessionTable).where(eq(agentSessionTable.id, SESSION_ID)).get()).toBeUndefined()
    expect(() => agentSessionMessageService.getSessionMessage(SESSION_ID, ASSISTANT_MESSAGE_ID)).toThrow()
    expect(
      dbh.db.select().from(agentWorkspaceTable).where(eq(agentWorkspaceTable.id, WORKSPACE_ID)).get()
    ).toBeDefined()
    await expect(service.restoreSession(SESSION_ID)).rejects.toThrow()
  })

  it('keeps archive and active-list permanent deletion state-specific across stale views', async () => {
    mocks.hasUnsettledTopicWork.mockReturnValue(false)
    const service = new AgentLifecycleService()
    await service.archiveSessions([SESSION_ID])
    await expect(service.deleteActiveSessionsPermanently([SESSION_ID])).resolves.toEqual({ deletedIds: [] })
    await service.restoreSession(SESSION_ID)
    await expect(service.purgeSessions([SESSION_ID])).resolves.toEqual({ deletedIds: [] })
    expect(agentSessionService.getById(SESSION_ID).id).toBe(SESSION_ID)
  })
})
