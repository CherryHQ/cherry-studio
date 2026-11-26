import { defaultServiceInstances } from '@test-mocks/main/application'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AgentRuntimeEvent } from '@main/ai/runtime/types'
import { BaseService } from '@main/core/lifecycle/BaseService'

const mocks = vi.hoisted(() => ({
  saveMessage: vi.fn(),
  replaceMessageParts: vi.fn(),
  getSessionMessage: vi.fn(),
  applyToolApprovalDecision: vi.fn(),
  getLastRuntimeResumeToken: vi.fn(),
  findCrashOrphanedAssistantMessages: vi.fn(),
  resolveCrashOrphanedMessages: vi.fn(),
  maybeRenameAgentSession: vi.fn(),
  applicationGet: vi.fn(),
  startRuntimeTurn: vi.fn(),
  abortStream: vi.fn(),
  suspendUnadmittedRuntimeTurn: vi.fn().mockResolvedValue(undefined),
  pauseRuntimeTurn: vi.fn(),
  broadcastTopicError: vi.fn(),
  resolveToolApproval: vi.fn(),
  terminateHeldTopicStream: vi.fn(),
  cacheSetShared: vi.fn(),
  cacheGetShared: vi.fn(),
  cacheDeleteShared: vi.fn(),
  closeWarmQueries: vi.fn(),

  getSessionById: vi.fn(),
  getAgent: vi.fn(),
  ensureTraceId: vi.fn(),
  recordUsage: vi.fn()
}))

vi.mock('@data/services/AgentSessionService', () => ({
  agentSessionService: { getById: mocks.getSessionById, ensureTraceId: mocks.ensureTraceId }
}))
vi.mock('@data/services/AgentService', () => ({
  agentService: { getAgent: mocks.getAgent, onAgentUpdated: () => () => {} }
}))
vi.mock('@data/services/AgentSessionMessageService', () => ({
  agentSessionMessageService: {
    saveMessage: mocks.saveMessage,
    branchTip: (_sessionId: string, messageId: string) => messageId,
    linkReply: vi.fn(),
    replaceMessageParts: mocks.replaceMessageParts,
    getSessionMessage: mocks.getSessionMessage,
    applyToolApprovalDecision: mocks.applyToolApprovalDecision,
    getLastRuntimeResumeToken: mocks.getLastRuntimeResumeToken,
    getNativeSessionId: vi.fn(),
    findCrashOrphanedAssistantMessages: mocks.findCrashOrphanedAssistantMessages,
    resolveCrashOrphanedMessages: mocks.resolveCrashOrphanedMessages
  }
}))
vi.mock('@data/services/AiUsageRecordService', () => ({
  aiUsageRecordService: { recordInvocation: mocks.recordUsage }
}))
vi.mock('@main/ai/utils/usageCapture', () => ({
  createAiUsageCaptureContext: (input: unknown) => input
}))
vi.mock('@main/services/TopicNamingService', () => ({
  topicNamingService: { maybeRenameAgentSession: mocks.maybeRenameAgentSession }
}))
vi.mock('@application', () => ({
  application: {
    get: (name: string) =>
      name === 'RuntimeActivityService' ? defaultServiceInstances[name] : mocks.applicationGet(name)
  }
}))

const { AgentSessionRuntimeService } = await import('../AgentSessionRuntimeService')
const { runtimeDriverRegistry } = await import('../../runtime/registry')

const baseTurnInput = {
  sessionId: 'session-1',
  topicId: 'agent-session:session-1',
  agentId: 'agent-1',
  agentType: 'test-runtime',
  modelId: 'cherryin::google/gemini-3.6-flash' as any,
  assistantMessageId: 'assistant-1',
  traceId: 'a'.repeat(32)
}

function getEntry(service: InstanceType<typeof AgentSessionRuntimeService>) {
  return (service as any).entries.get('session-1')
}

function currentTurn(entry: any) {
  const execution = entry.runtimeState.execution
  if (execution.kind === 'turn' || execution.kind === 'autonomous-turn') return execution.reply.turn
  if (execution.kind === 'run-handoff') return execution.reply.turn
  return execution.lastTurn
}

beforeEach(() => {
  BaseService.resetInstances()
  runtimeDriverRegistry.clearForTest()
  vi.clearAllMocks()
  mocks.saveMessage.mockImplementation(({ message }: any) => ({ ...message, id: message.id ?? 'receive-only-row' }))
  mocks.getSessionMessage.mockReturnValue({ id: 'assistant-1', role: 'assistant', data: { parts: [] } })
  mocks.getLastRuntimeResumeToken.mockReturnValue(null)
  mocks.findCrashOrphanedAssistantMessages.mockReturnValue([])
  mocks.ensureTraceId.mockReturnValue('b'.repeat(32))
  mocks.getAgent.mockReturnValue({ id: 'agent-1', type: 'test-runtime', model: baseTurnInput.modelId })
  mocks.applicationGet.mockImplementation((name: string) => {
    if (name === 'AiStreamManager') {
      return {
        getInteractionWindow: () => undefined,
        startRuntimeTurn: mocks.startRuntimeTurn,
        abort: mocks.abortStream,
        drainRuntimeReply: async () => {},
        suspendUnadmittedRuntimeTurn: mocks.suspendUnadmittedRuntimeTurn,
        pauseRuntimeTurn: mocks.pauseRuntimeTurn,
        broadcastTopicError: mocks.broadcastTopicError,
        resolveToolApproval: mocks.resolveToolApproval,
        terminateHeldTopicStream: mocks.terminateHeldTopicStream
      }
    }
    if (name === 'CacheService') {
      return {
        setShared: mocks.cacheSetShared,
        getShared: mocks.cacheGetShared,
        deleteShared: mocks.cacheDeleteShared
      }
    }
    if (name === 'ClaudeCodeWarmQueryManager') {
      return { closeAll: mocks.closeWarmQueries }
    }
    throw new Error(`Unexpected application.get(${name})`)
  })
})

describe('subagent settlement wake (incident replay)', () => {
  /**
   * A receive-only turn streams on a connection that already exists, so every facet it records has
   * to be the one that connection is targeted at. `reasoningEffort` used to be pinned to the literal
   * `'default'` while `modelId`, `serviceTier`, knowledge scope and Fast all came from
   * `connectionTarget`. For an agent configured with a non-default effort that made an autonomous
   * wake disagree with its own connection, and an agent write racing the wake reported drift and
   * closed a warm connection that was serving correctly.
   */
  it('gives a wake turn the effort its connection is targeted at, and survives a racing agent write', async () => {
    mocks.getAgent.mockReturnValue({
      id: 'agent-1',
      type: 'test-runtime',
      model: baseTurnInput.modelId,
      configuration: { reasoning_effort: 'high' }
    })
    const service = new AgentSessionRuntimeService()
    const handleRuntimeEvent = (event: AgentRuntimeEvent) =>
      (service as any).handleRuntimeEvent(getEntry(service), event)

    // `AgentChatContextProvider` is the only production caller of `beginTurn`, and it passes
    // `req.reasoningEffort ?? agent.configuration.reasoning_effort ?? 'default'`, so a turn for this
    // agent arrives already resolved to 'high'.
    service.beginTurn({ ...baseTurnInput, reasoningEffort: 'high' } as any)
    const entry = getEntry(service)
    const connection = {
      send: vi.fn(),
      close: vi.fn(),
      events: [],
      reconcile: vi.fn(async (target: any) => (target.reasoningEffort === 'high' ? 'current' : 'rebuild')),
      refreshTraceContext: vi.fn()
    }
    entry.runtimeState.connection = { kind: 'connected', connection, occupancy: {} }

    handleRuntimeEvent({ type: 'turn-complete' })
    service.markTurnTerminal('session-1', 'success')

    handleRuntimeEvent({ type: 'autonomous-turn-state', state: 'started', origin: { kind: 'background-work' } })

    await vi.waitFor(() => expect(mocks.startRuntimeTurn).toHaveBeenCalledTimes(1))

    expect(currentTurn(entry).reasoningEffort).toBe('high')
    expect(mocks.startRuntimeTurn.mock.calls[0][0].request.reasoningEffort).toBe('high')

    // An unrelated agent write lands while the wake is streaming: nothing it serves changed, so the
    // connection must stay open.
    await (service as any).handleAgentUpdated(
      'agent-1',
      { name: 'Renamed' },
      { id: 'agent-1', name: 'Renamed', model: baseTurnInput.modelId, configuration: { reasoning_effort: 'high' } }
    )
    expect(connection.close).not.toHaveBeenCalled()

    handleRuntimeEvent({ type: 'autonomous-turn-state', state: 'finished' })
    handleRuntimeEvent({ type: 'turn-complete' })
    void service.closeSession('session-1')
  })
})
