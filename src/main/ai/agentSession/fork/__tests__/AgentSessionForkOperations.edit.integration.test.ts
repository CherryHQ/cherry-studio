import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { BaseService } from '@main/core/lifecycle/BaseService'
import type { CherryMessagePart } from '@shared/data/types/message'
import { createChannelContextPart } from '@shared/data/types/uiParts'

import { restoreStoredChannelContext, stripChannelContextParts } from '../../../../utils/channelContextParts'
import { runtimeDriverRegistry } from '../../../runtime/registry'

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
      isForkCheckpoint: () => true,
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

  it('hands the persist callback the stored parts captured from the version-checked snapshot', async () => {
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

    const seen: { storedUserParts?: unknown } = {}
    const result = await forks.edit(
      SESSION_ID,
      targetFor(USER_MESSAGE_ID),
      async () => {},
      (_tx, nativeSessionId, _nativeContextId, storedUserParts) => {
        seen.storedUserParts = storedUserParts
        expect(nativeSessionId).toBeTruthy()
        return 'persisted'
      }
    )

    expect(result).toBe('persisted')
    // The capture comes from the stored row, so the hidden context survives even though the
    // renderer's resent parts never carry it.
    expect(seen.storedUserParts).toEqual([{ type: 'text', text: 'original' }, storedContext])
    // Main replaces the edited tail, after capturing its authoritative hidden context.
    const db = application.get('DbService').getDb()
    expect(
      db.select().from(agentSessionMessageTable).where(eq(agentSessionMessageTable.id, USER_MESSAGE_ID)).get()
    ).toBeUndefined()
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

    let storedUserParts: CherryMessagePart[] | undefined
    await forks.edit(
      SESSION_ID,
      targetFor(USER_MESSAGE_ID),
      async () => {},
      (_tx, _native, _nativeContextId, parts) => {
        storedUserParts = parts
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
      (_tx, _native, _nativeContextId, storedUserParts) => {
        persistedParts = restoreStoredChannelContext(rendererParts, storedUserParts)
      }
    )

    expect(persistedParts).toEqual([{ type: 'text', text: 'edited' }, storedContext])
    expect(JSON.stringify(persistedParts)).not.toContain('oc_forged')
  })

  it('a forged message PATCH cannot replace the context that edit-resend restores', async () => {
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

    // Renderer DataApi PATCH (the message-update write path) attempts to swap in a forged context.
    agentSessionMessageService.updateSessionMessage(SESSION_ID, USER_MESSAGE_ID, {
      data: { parts: [forgedContext, { type: 'text', text: 'patched' }] }
    })

    // The subsequent edit-and-resend must restore only the authoritative stored context.
    let persistedParts: unknown
    await forks.edit(
      SESSION_ID,
      targetFor(USER_MESSAGE_ID),
      async () => {},
      (_tx, _native, _nativeContextId, storedUserParts) => {
        persistedParts = restoreStoredChannelContext(
          stripChannelContextParts([{ type: 'text', text: 're-sent' } as never]),
          storedUserParts
        )
      }
    )

    expect(persistedParts).toEqual([{ type: 'text', text: 're-sent' }, storedContext])
    expect(JSON.stringify(persistedParts)).not.toContain('oc_forged')
  })
})
