import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { ConversationKind } from '@shared/ai/conversation'
import { createUniqueModelId } from '@shared/data/types/model'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AgentConversationRuntimeTurnKind } from '../../../agentSession/AgentConnectionManager'
import type { StreamListener } from '../../types'

const manager = vi.hoisted(() => ({
  activateConversationRuntimeTurn: vi.fn(async () => {}),
  rejectConversationRuntimeTurn: vi.fn(),
  releaseExecutionResource: vi.fn(),
  runtimeResumeToken: vi.fn(() => undefined)
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const module = mockApplicationFactory()
  const get = module.application.get
  module.application.get = vi.fn((name: string) =>
    name === 'AgentConnectionManager' ? manager : get(name)
  ) as typeof module.application.get
  return module
})

const { AgentChatContextProvider } = await import('../AgentChatContextProvider')

const SESSION_ID = 'session-1'
const ASSISTANT_ID = '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d002'
const MODEL_ID = createUniqueModelId('provider', 'model')

function listener(): StreamListener {
  return {
    id: 'listener-1',
    onChunk: vi.fn(),
    onDone: vi.fn(),
    onPaused: vi.fn(),
    onError: vi.fn(),
    isAlive: () => true
  }
}

describe('AgentChatContextProvider runtime turn commit', () => {
  const dbh = setupTestDatabase()

  beforeEach(async () => {
    vi.clearAllMocks()
    await dbh.db.insert(agentWorkspaceTable).values({
      id: 'workspace-1',
      name: 'Workspace',
      path: '/tmp/workspace-1',
      type: 'user',
      orderKey: 'workspace-1'
    })
    await dbh.db.insert(userProviderTable).values({
      providerId: 'provider',
      name: 'Provider',
      orderKey: 'provider-1'
    })
    await dbh.db.insert(userModelTable).values({
      id: MODEL_ID,
      providerId: 'provider',
      modelId: 'model',
      presetModelId: 'model',
      name: 'Model',
      orderKey: 'model-1'
    })
    await dbh.db.insert(agentSessionTable).values({
      id: SESSION_ID,
      workspaceId: 'workspace-1',
      name: 'Session',
      orderKey: 'session-1',
      createdAt: 0,
      lastActivityAt: 0,
      updatedAt: 0
    })
  })

  it('commits the assistant skeleton before activating the connection resource', async () => {
    const abortController = new AbortController()
    const provider = new AgentChatContextProvider()
    const committed = provider.commitRuntimeTurn(
      {
        kind: AgentConversationRuntimeTurnKind.Autonomous,
        conversation: { kind: ConversationKind.Agent, id: SESSION_ID },
        agentId: 'agent-1',
        modelId: MODEL_ID,
        reasoningEffort: 'default',
        fastMode: false,
        knowledgeBaseIds: [],
        headless: true,
        userMessage: {
          id: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d001',
          sessionId: SESSION_ID,
          role: 'user',
          status: 'success',
          data: { parts: [] },
          searchableText: '',
          modelId: null,
          messageSnapshot: null,
          stats: null,
          runtimeResumeToken: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z'
        },
        assistantMessageId: ASSISTANT_ID,
        runtimeTurnId: 'runtime-turn-1',
        abortController
      },
      listener()
    )

    expect(
      dbh.db
        .select({ id: agentSessionMessageTable.id, status: agentSessionMessageTable.status })
        .from(agentSessionMessageTable)
        .where(eq(agentSessionMessageTable.id, ASSISTANT_ID))
        .get()
    ).toEqual({ id: ASSISTANT_ID, status: 'pending' })
    expect(manager.activateConversationRuntimeTurn).not.toHaveBeenCalled()

    const context = await committed.prepareExecutionContext(abortController.signal)

    expect(manager.activateConversationRuntimeTurn).toHaveBeenCalledOnce()
    expect(context.models[0]?.request.messageId).toBe(ASSISTANT_ID)
    expect(committed.reservation.models[0]?.outputNodeId).toBe(ASSISTANT_ID)
  })
})
