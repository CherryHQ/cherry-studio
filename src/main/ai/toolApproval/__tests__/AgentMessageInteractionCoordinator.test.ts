import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { AgentApprovalLifetime, type AgentRuntimeToolApprovalRequest } from '@main/ai/runtime/types'
import type { UniqueModelId } from '@shared/data/types/model'
import { setupTestDatabase } from '@test-helpers/db'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { agentMessageInteractionCoordinator } from '../AgentMessageInteractionCoordinator'
import { toolApprovalRegistry } from '../ToolApprovalRegistry'

const SESSION_ID = 'session-1'
const MODEL_ID = 'openai::gpt-4o' as UniqueModelId

function request(approvalId: string): AgentRuntimeToolApprovalRequest & {
  lifetime: AgentApprovalLifetime.SessionMessage
} {
  return {
    approvalId,
    toolCallId: `tool-call-${approvalId}`,
    toolName: 'Read',
    input: { path: '/tmp/input.txt' },
    lifetime: AgentApprovalLifetime.SessionMessage
  }
}

describe('AgentMessageInteractionCoordinator', () => {
  const dbh = setupTestDatabase()

  beforeEach(async () => {
    toolApprovalRegistry.clear('test-reset')
    await dbh.db.insert(agentWorkspaceTable).values({
      id: 'workspace-1',
      name: 'Workspace',
      path: '/tmp/workspace-1',
      type: 'user',
      orderKey: 'workspace-1'
    })
    await dbh.db.insert(agentTable).values({
      id: 'agent-1',
      type: 'claude-code',
      name: 'Agent',
      instructions: 'test',
      orderKey: 'agent-1'
    })
    await dbh.db.insert(userProviderTable).values({ providerId: 'openai', name: 'OpenAI', orderKey: 'openai' })
    await dbh.db.insert(userModelTable).values({
      id: MODEL_ID,
      providerId: 'openai',
      modelId: 'gpt-4o',
      presetModelId: 'openai::gpt-4o',
      orderKey: 'gpt-4o'
    })
    await dbh.db.insert(agentSessionTable).values({
      id: SESSION_ID,
      agentId: 'agent-1',
      workspaceId: 'workspace-1',
      name: 'Session',
      orderKey: 'session-1'
    })
  })

  afterEach(() => {
    toolApprovalRegistry.clear('test-cleanup')
    vi.restoreAllMocks()
  })

  it('terminalizes a bound message approval before resolving its runtime promise on teardown', () => {
    const resolve = vi.fn()
    const approval = request('approval-teardown')
    expect(
      toolApprovalRegistry.register({
        ...approval,
        sessionId: SESSION_ID,
        originalInput: approval.input,
        resolve
      })
    ).toBe(true)
    const message = agentMessageInteractionCoordinator.present({
      sessionId: SESSION_ID,
      request: approval,
      modelId: MODEL_ID
    })
    expect(message).toBeDefined()

    expect(agentMessageInteractionCoordinator.teardownSession(SESSION_ID, 'session-ended')).toBe(1)

    const persisted = agentSessionMessageService.getSessionMessage(SESSION_ID, message!.id)
    expect(persisted.data.parts).toEqual([
      expect.objectContaining({
        state: 'approval-responded',
        approval: expect.objectContaining({ id: approval.approvalId, approved: false, reason: 'session-ended' })
      })
    ])
    expect(resolve).toHaveBeenCalledExactlyOnceWith({ approved: false, reason: 'session-ended' })
    expect(toolApprovalRegistry.peek(approval.approvalId)).toBeUndefined()
  })

  it('lets the durable user response win a race with session teardown exactly once', () => {
    const resolve = vi.fn()
    const approval = request('approval-response')
    toolApprovalRegistry.register({
      ...approval,
      sessionId: SESSION_ID,
      originalInput: approval.input,
      resolve
    })
    const message = agentMessageInteractionCoordinator.present({
      sessionId: SESSION_ID,
      request: approval,
      modelId: MODEL_ID
    })!

    expect(agentMessageInteractionCoordinator.respond(approval.approvalId, { approved: true }, message.id)).toBe(true)
    expect(agentMessageInteractionCoordinator.teardownSession(SESSION_ID)).toBe(0)

    const persisted = agentSessionMessageService.getSessionMessage(SESSION_ID, message.id)
    expect(persisted.data.parts).toEqual([
      expect.objectContaining({
        state: 'approval-responded',
        approval: expect.objectContaining({ id: approval.approvalId, approved: true })
      })
    ])
    expect(resolve).toHaveBeenCalledExactlyOnceWith({ approved: true })
  })

  it('does not leave an answerable card when persistence fails', () => {
    const resolve = vi.fn()
    const approval = request('approval-persist-failure')
    toolApprovalRegistry.register({
      ...approval,
      sessionId: SESSION_ID,
      originalInput: approval.input,
      resolve
    })
    vi.spyOn(agentSessionMessageService, 'saveMessage').mockImplementationOnce(() => {
      throw new Error('disk full')
    })

    expect(
      agentMessageInteractionCoordinator.present({ sessionId: SESSION_ID, request: approval, modelId: MODEL_ID })
    ).toBeUndefined()
    expect(agentSessionMessageService.listSessionMessages(SESSION_ID).items).toEqual([])
    expect(resolve).toHaveBeenCalledExactlyOnceWith({
      approved: false,
      reason: 'Unable to present this approval request to the user'
    })
    expect(toolApprovalRegistry.peek(approval.approvalId)).toBeUndefined()
  })
})
