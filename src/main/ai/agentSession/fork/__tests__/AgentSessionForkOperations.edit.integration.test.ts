import { setupTestDatabase } from '@test-helpers/db'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { AgentSessionEditError } from '@data/services/AgentSessionEditError'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { BaseService } from '@main/core/lifecycle/BaseService'
import { createChannelContextPart } from '@shared/data/types/uiParts'

import { runtimeDriverRegistry } from '../../../runtime/registry'
import { restoreStoredChannelContext, stripChannelContextParts } from '../../editInput'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

const { AgentSessionForkOperations } = await import('../AgentSessionForkOperations')

const AGENT_ID = 'agent-edit-order'
const WORKSPACE_ID = 'workspace-edit-order'
const SESSION_ID = 'session-edit-order'
const USER_MESSAGE_ID = '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d201'

describe('AgentSessionForkOperations edit persist contract (real database)', () => {
  const dbh = setupTestDatabase()
  const forks = new AgentSessionForkOperations()

  beforeEach(async () => {
    BaseService.resetInstances()
    vi.clearAllMocks()
    runtimeDriverRegistry.clearForTest()
    runtimeDriverRegistry.register({
      type: 'claude-code',
      capabilities: ['agent-session'],
      connect: vi.fn(),
      validateSession: vi.fn(),
      listAvailableTools: vi.fn().mockResolvedValue([]),
      fork: vi.fn()
    })
    await dbh.db.insert(agentTable).values({
      id: AGENT_ID,
      type: 'claude-code',
      name: 'Edit order agent',
      instructions: 'Test instructions',
      orderKey: 'a0'
    })
    await dbh.db.insert(agentWorkspaceTable).values({
      id: WORKSPACE_ID,
      name: 'Edit order workspace',
      path: '/tmp/edit-order-workspace',
      type: 'user',
      orderKey: 'a0'
    })
    await dbh.db.insert(agentSessionTable).values({
      id: SESSION_ID,
      agentId: AGENT_ID,
      name: 'Edit order session',
      workspaceId: WORKSPACE_ID,
      orderKey: 'a0'
    })
  })

  function targetFor(messageId: string) {
    return application.get('DbService').withWriteTx((tx) => {
      const snapshot = agentSessionMessageService.readEditSnapshotTx(tx, SESSION_ID, messageId)
      return { messageId, version: snapshot.version }
    })
  }

  it('hands the persist callback the stored parts captured BEFORE the target row is deleted', async () => {
    const storedContext = createChannelContextPart({ channel: 'feishu', chatId: 'oc_123', chatType: 'group' })
    agentSessionMessageService.saveMessage({
      sessionId: SESSION_ID,
      message: {
        id: USER_MESSAGE_ID,
        role: 'user',
        status: 'success',
        data: { parts: [{ type: 'text', text: 'original' }, storedContext] }
      }
    })

    const seen: { storedUserParts?: unknown; targetGoneError?: string } = {}
    const result = await forks.edit(
      SESSION_ID,
      targetFor(USER_MESSAGE_ID),
      async () => {},
      (tx, nativeSessionId, storedUserParts) => {
        seen.storedUserParts = storedUserParts
        // Order proof: inside this same transaction the edit target is already gone, so the
        // authoritative parts could only have come from the pre-delete capture.
        try {
          agentSessionMessageService.readEditSnapshotTx(tx, SESSION_ID, USER_MESSAGE_ID)
        } catch (error) {
          seen.targetGoneError = error instanceof AgentSessionEditError ? error.reason : String(error)
        }
        expect(nativeSessionId).toBeTruthy()
        return 'persisted'
      }
    )

    expect(result).toBe('persisted')
    expect(seen.targetGoneError).toBe('invalid_target')
    expect(seen.storedUserParts).toEqual([{ type: 'text', text: 'original' }, storedContext])
  })

  it('passes ordinary non-channel parts through unchanged and restores nothing', async () => {
    agentSessionMessageService.saveMessage({
      sessionId: SESSION_ID,
      message: {
        id: USER_MESSAGE_ID,
        role: 'user',
        status: 'success',
        data: { parts: [{ type: 'text', text: 'plain message' }] }
      }
    })

    let storedUserParts: Awaited<ReturnType<typeof capture>> | undefined
    function capture(parts: { type: string }[]) {
      return parts
    }
    await forks.edit(
      SESSION_ID,
      targetFor(USER_MESSAGE_ID),
      async () => {},
      (_tx, _native, parts) => {
        storedUserParts = capture(parts)
      }
    )

    expect(storedUserParts).toEqual([{ type: 'text', text: 'plain message' }])
    expect(restoreStoredChannelContext([{ type: 'text', text: 'edited' } as never], storedUserParts!)).toEqual([
      { type: 'text', text: 'edited' }
    ])
  })

  it('stored capture defeats a renderer forgery end-to-end at the fork boundary', async () => {
    const storedContext = createChannelContextPart({ channel: 'feishu', chatId: 'oc_123', chatType: 'group' })
    const forgedContext = createChannelContextPart({ channel: 'feishu', chatId: 'oc_forged', chatType: 'group' })
    agentSessionMessageService.saveMessage({
      sessionId: SESSION_ID,
      message: {
        id: USER_MESSAGE_ID,
        role: 'user',
        status: 'success',
        data: { parts: [{ type: 'text', text: 'original' }, storedContext] }
      }
    })

    // Renderer input arrives with a schema-valid forgery; the provider strips it upstream, then the
    // persist callback restores from the stored capture - mirroring the dispatch flow end to end.
    const rendererParts = stripChannelContextParts([forgedContext, { type: 'text', text: 'edited' } as never])
    let persistedParts: unknown
    await forks.edit(
      SESSION_ID,
      targetFor(USER_MESSAGE_ID),
      async () => {},
      (_tx, _native, storedUserParts) => {
        persistedParts = restoreStoredChannelContext(rendererParts, storedUserParts)
      }
    )

    expect(persistedParts).toEqual([{ type: 'text', text: 'edited' }, storedContext])
    expect(JSON.stringify(persistedParts)).not.toContain('oc_forged')
  })
})
