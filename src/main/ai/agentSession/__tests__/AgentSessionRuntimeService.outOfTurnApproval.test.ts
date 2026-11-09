import { setupTestDatabase } from '@test-helpers/db'
import { mockMainLoggerService } from '@test-mocks/MainLoggerService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import type * as SessionWorkspaceModule from '@main/ai/runtime/agentSessionWorkspace'
import { ClaudeCodeSessionStateService } from '@main/ai/runtime/claudeCode/ClaudeCodeSessionStateService'
import type * as ClaudeEnvironmentModule from '@main/ai/runtime/claudeCode/environment'
import { buildClaudeCodeSessionSettings } from '@main/ai/runtime/claudeCode/settingsBuilder'
import type { AgentRuntimeEvent } from '@main/ai/runtime/types'
import { toolApprovalRegistry } from '@main/ai/toolApproval/ToolApprovalRegistry'
import { BaseService } from '@main/core/lifecycle/BaseService'

import { AgentSessionRuntimeService } from '../AgentSessionRuntimeService'

const { notifyDataChange } = vi.hoisted(() => ({ notifyDataChange: vi.fn() }))
vi.mock('@data/dataApiDataChange', () => ({ notifyDataApiDataChange: notifyDataChange }))
vi.mock('@main/ai/agents/agentDataDirectory', () => ({ ensureAgentDataDirectory: async () => '/workspace/agent-data' }))
vi.mock('@main/ai/runtime/agentSessionWorkspace', async (importOriginal) => ({
  ...(await importOriginal<typeof SessionWorkspaceModule>()),
  assertAgentSessionWorkspaceDirectory: async () => {},
  prepareAgentSessionWorkspaceDirectory: async () => {}
}))
vi.mock('@main/ai/runtime/agentPrompt', () => ({
  buildAgentRuntimePrompt: async () => ({ base: { kind: 'native' }, append: '' })
}))
vi.mock('@main/ai/skills/SkillService', () => ({
  skillService: { list: async () => [], listLocalFolderNames: async () => [] }
}))
vi.mock('@main/ai/runtime/claudeCode/mcpCatalog', () => ({
  warmAgentMcpToolCaches: async () => ({ completedInTime: true }),
  buildMcpServers: () => ({}),
  buildMcpToolMetadata: async () => undefined
}))
vi.mock('@main/ai/runtime/claudeCode/environment', async (importOriginal) => ({
  ...(await importOriginal<typeof ClaudeEnvironmentModule>()),
  buildEnvironment: async () => ({}),
  resolveClaudeExecutablePath: () => '/sdk/claude'
}))

const sessionId = 'session-23291'
const denial = {
  behavior: 'deny',
  message:
    'This tool call arrived after its turn had already ended, so no one can approve it. Request it again in your next turn if you still need it.'
}
const notice = {
  type: 'data-error',
  data: {
    name: 'OutOfTurnApprovalDenied',
    code: 'OUT_OF_TURN_APPROVAL_DENIED',
    i18nKey: 'claude_code_out_of_turn_approval',
    message:
      'Cherry Studio blocked a tool request because its approval could not be presented in the active turn. Stop any remaining run, then send a new message in this session asking the agent to retry. The blocked request was not executed.'
  }
}

// These cases catch silent late-call denials and unanswerable approvals after real turn settlement.
describe('out-of-turn Claude Code approvals', () => {
  const dbh = setupTestDatabase()
  let service: AgentSessionRuntimeService
  let sessionState: ClaudeCodeSessionStateService
  const send = vi.fn()
  const approvalRequested = vi.fn()

  beforeEach(() => {
    BaseService.resetInstances()
    vi.clearAllMocks()
    service = new AgentSessionRuntimeService()
    sessionState = new ClaudeCodeSessionStateService()
    service.onApprovalRequested(approvalRequested)
    const originalGet = application.getContainer().get.bind(application.getContainer())
    vi.spyOn(application, 'get').mockImplementation((name) => {
      if (name === 'AgentSessionRuntimeService') return service
      if (name === 'ClaudeCodeSessionStateService') return sessionState
      if (name === 'AiStreamManager') return { getInteractionWindow: () => undefined } as never
      return originalGet(name)
    })
    const snapshot = {
      resolve: () => ({ approval: 'prompt' }),
      isDisabled: () => false,
      getPermissionMode: () => 'default',
      update: vi.fn(),
      setPermissionMode: vi.fn()
    } as never
    vi.spyOn(sessionState, 'ensureToolPolicySnapshot').mockResolvedValue(snapshot)
    vi.spyOn(sessionState, 'getToolPolicySnapshot').mockReturnValue(snapshot)
    dbh.db.insert(userProviderTable).values({ providerId: 'claude-code', name: 'Claude Code', orderKey: 'a0' }).run()
    dbh.db
      .insert(userModelTable)
      .values({
        id: 'claude-code::claude-sonnet-4-5',
        providerId: 'claude-code',
        modelId: 'claude-sonnet-4-5',
        name: 'Claude Sonnet',
        capabilities: [],
        supportsStreaming: true,
        orderKey: 'a0'
      })
      .run()
    dbh.db
      .insert(agentWorkspaceTable)
      .values({ id: 'workspace-23291', name: 'Workspace', path: '/workspace/23291', orderKey: 'a0' })
      .run()
    dbh.db
      .insert(agentSessionTable)
      .values({ id: sessionId, name: 'Session', workspaceId: 'workspace-23291', orderKey: 'a0' })
      .run()
  })

  afterEach(async () => {
    toolApprovalRegistry.abort(sessionId, 'test-cleanup')
    await service.closeSession(sessionId)
    vi.restoreAllMocks()
  })

  async function settings() {
    const result = await buildClaudeCodeSessionSettings(
      { id: sessionId, agentId: 'agent-23291', workspace: { type: 'user', path: '/workspace/23291' } } as never,
      {} as never,
      {
        linkedChannelSnapshot: null,
        notificationContext: { sourceChannel: null, channels: [], allowAnyOwnedChannel: false }
      },
      {
        id: 'agent-23291',
        type: 'claude-code',
        mcps: [],
        allowedTools: [],
        configuration: { permission_mode: 'default' }
      } as never
    )
    result.approvalEmitter!.emit = (request) => emit({ type: 'tool-approval-request', request })
    return result
  }

  function entry() {
    return (service as any).entries.get(sessionId)
  }

  function emit(event: AgentRuntimeEvent) {
    ;(service as any).handleRuntimeEvent(entry(), event)
  }

  async function settleTurn(occupancy: 'none' | 'interactive' | 'headless' = 'none') {
    const handle = service.beginTurn({
      sessionId,
      topicId: `agent-session:${sessionId}`,
      agentId: 'agent-23291',
      agentType: 'claude-code',
      modelId: 'claude-code::claude-sonnet-4-5',
      assistantMessageId: 'assistant-23291',
      headless: occupancy === 'headless'
    })
    entry().runtimeState.connection = {
      kind: 'connected',
      connection: {
        send,
        close: vi.fn(),
        reconcile: vi.fn().mockResolvedValue('current'),
        refreshTraceContext: vi.fn()
      },
      occupancy: {}
    }
    const reader = service
      .openTurnStream({ sessionId, turnId: handle.turnId, signal: handle.abortController.signal })
      .getReader()
    await expect(reader.read()).resolves.toMatchObject({ value: { type: 'start' } })
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    if (occupancy !== 'none') emit({ type: 'background-work-state', active: true, awaitingReply: false })
    emit({ type: 'turn-complete' })
    expect(entry().runtimeState.execution).toMatchObject({
      kind: 'turn',
      stream: 'awaiting-persistence'
    })
    while (!(await reader.read()).done) {
      /* Drain the completed stream before terminal persistence. */
    }
    await handle.listeners
      .find((listener) => listener.id === `agent-runtime:${sessionId}`)!
      .onDone({ status: 'success' })
    expect(entry().runtimeState.execution.kind).toBe('idle')
    send.mockClear()
    notifyDataChange.mockClear()
  }

  async function requestEdit() {
    const built = await settings()
    return built.canUseTool!(
      'Edit',
      { file_path: '/workspace/23291/marker', old_string: 'before', new_string: 'after' },
      {
        signal: new AbortController().signal,
        toolUseID: 'edit-23291',
        requestId: 'request-23291'
      }
    )
  }

  it('persists a recovery notice for a denied Edit after an interactive turn settles without occupancy', async () => {
    await settleTurn()
    expect(service.getInteractionState(sessionId)).toEqual({ currentTurn: 'none', userResponse: 'unavailable' })
    await expect(requestEdit()).resolves.toEqual(denial)
    const rows = dbh.db.select().from(agentSessionMessageTable).all()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      sessionId,
      role: 'assistant',
      status: 'error',
      modelId: null,
      messageSnapshot: null,
      data: { parts: [notice] }
    })
    expect(toolApprovalRegistry.hasSession(sessionId)).toBe(false)
    expect(send).not.toHaveBeenCalled()
    expect(approvalRequested).not.toHaveBeenCalled()
    expect(notifyDataChange).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          endpoint: '/agent-sessions/:sessionId/messages',
          routeParams: { sessionId },
          entityIds: [rows[0].id]
        })
      ])
    )
    expect(entry().runtimeState.execution.kind).toBe('idle')
  })

  it('persists a pending approval card without a notice for interactive command-only occupancy', async () => {
    await settleTurn('interactive')
    expect(service.getInteractionState(sessionId)).toEqual({ currentTurn: 'none', userResponse: 'message' })
    const settled = vi.fn()
    const pending = requestEdit().then((result) => {
      settled(result)
      return result
    })
    await vi.waitFor(() => expect(dbh.db.select().from(agentSessionMessageTable).all()).toHaveLength(1))
    expect(settled).not.toHaveBeenCalled()
    const [row] = dbh.db.select().from(agentSessionMessageTable).all()
    expect(row).toMatchObject({
      status: 'success',
      data: { parts: [expect.objectContaining({ type: 'tool-Edit', state: 'approval-requested' })] }
    })
    expect(toolApprovalRegistry.hasSession(sessionId)).toBe(true)
    expect(send).not.toHaveBeenCalled()
    expect(approvalRequested).toHaveBeenCalledTimes(1)
    const part = row.data.parts![0] as { approval: { id: string } }
    toolApprovalRegistry.dispatch(part.approval.id, { approved: false, reason: 'User declined' })
    await expect(pending).resolves.toMatchObject({ behavior: 'deny', message: 'User declined' })
  })

  it('keeps a late main-agent Edit denied without a notice or card for headless background occupancy', async () => {
    await settleTurn('headless')
    expect(service.getInteractionState(sessionId)).toEqual({ currentTurn: 'none', userResponse: 'unavailable' })
    await expect(requestEdit()).resolves.toEqual(denial)
    expect(dbh.db.select().from(agentSessionMessageTable).all()).toEqual([])
    expect(toolApprovalRegistry.hasSession(sessionId)).toBe(false)
    expect(send).not.toHaveBeenCalled()
    expect(approvalRequested).not.toHaveBeenCalled()
  })

  it('ignores a missing runtime entry without throwing or persisting a notice', async () => {
    await expect(requestEdit()).resolves.toEqual(denial)
    expect(() => service.reportOutOfTurnApprovalDenied('missing-session')).not.toThrow()
    expect(dbh.db.select().from(agentSessionMessageTable).all()).toEqual([])
    expect(toolApprovalRegistry.hasSession(sessionId)).toBe(false)
    expect(send).not.toHaveBeenCalled()
    expect(approvalRequested).not.toHaveBeenCalled()
  })

  it('leaves an independent pending approval untouched when publishing a denial notice', async () => {
    await settleTurn()
    const resolve = vi.fn()
    toolApprovalRegistry.register({
      approvalId: 'existing-approval',
      sessionId,
      toolCallId: 'existing-call',
      toolName: 'AskUserQuestion',
      originalInput: {},
      presentation: 'message',
      resolve
    })
    const card = agentSessionMessageService.saveMessage({
      sessionId,
      message: {
        role: 'assistant',
        status: 'success',
        modelId: null,
        messageSnapshot: null,
        data: {
          parts: [
            {
              type: 'tool-AskUserQuestion',
              toolCallId: 'existing-call',
              state: 'approval-requested',
              input: {},
              approval: { id: 'existing-approval' }
            }
          ]
        }
      }
    })

    await expect(requestEdit()).resolves.toEqual(denial)

    expect(agentSessionMessageService.getSessionMessage(sessionId, card.id)).toMatchObject({
      id: card.id,
      status: 'success',
      data: card.data
    })
    const rows = dbh.db.select().from(agentSessionMessageTable).all()
    expect(rows).toHaveLength(2)
    expect(rows.filter((row) => row.status === 'error').map((row) => row.data.parts)).toEqual([[notice]])
    expect(toolApprovalRegistry.hasSession(sessionId)).toBe(true)
    expect(resolve).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
    expect(approvalRequested).not.toHaveBeenCalled()
  })

  it('retains the SDK denial and logs a failed notice save', async () => {
    await settleTurn()
    const error = new Error('notice storage unavailable')
    vi.spyOn(agentSessionMessageService, 'saveMessage').mockImplementationOnce(() => {
      throw error
    })
    await expect(requestEdit()).resolves.toEqual(denial)
    expect(mockMainLoggerService.error).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ sessionId, error })
    )
    expect(dbh.db.select().from(agentSessionMessageTable).all()).toEqual([])
    expect(toolApprovalRegistry.hasSession(sessionId)).toBe(false)
    expect(send).not.toHaveBeenCalled()
    expect(approvalRequested).not.toHaveBeenCalled()
  })
})
