/**
 * Incident repro (2026-08-15): a dsh subagent settlement wake opened a
 * receive-only turn whose persisted row ended up with ZERO parts while the
 * runtime streamed a full report. Drive the real service with the incident's
 * event order and assert the receive-only stream actually carries the chunks.
 */
import { BaseService } from '@main/core/lifecycle/BaseService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
  closeAgentSessionWarm: vi.fn(),
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
    persistExistingAssistantMessage: mocks.saveMessage,
    replaceMessageParts: mocks.replaceMessageParts,
    getSessionMessage: mocks.getSessionMessage,
    applyToolApprovalDecision: mocks.applyToolApprovalDecision,
    getLastRuntimeResumeToken: mocks.getLastRuntimeResumeToken,
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
vi.mock('@application', () => ({ application: { get: mocks.applicationGet } }))

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
  if (execution.kind === 'turn' || execution.kind === 'autonomous-turn') return execution.turn
  if (execution.kind === 'steer-transition') return execution.continuationTurn ?? execution.sourceTurn
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
        startRuntimeTurn: mocks.startRuntimeTurn,
        abort: mocks.abortStream,
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
      return { closeAll: mocks.closeWarmQueries, closeAgentSessionWarm: mocks.closeAgentSessionWarm }
    }
    throw new Error(`Unexpected application.get(${name})`)
  })
})

describe('subagent settlement wake (incident replay)', () => {
  it('delivers wake-turn chunks into the receive-only stream under background occupancy', async () => {
    const service = new AgentSessionRuntimeService()
    const handleRuntimeEvent = (event: unknown) => (service as any).handleRuntimeEvent(getEntry(service), event)

    // Turn 1: the spawning user turn, streamed and settled normally.
    service.beginTurn(baseTurnInput)
    const entry = getEntry(service)
    entry.runtimeState.connection = {
      kind: 'connected',
      connection: {
        send: vi.fn(),
        close: vi.fn(),
        events: [],
        reconcile: vi.fn().mockResolvedValue('current'),
        refreshTraceContext: vi.fn()
      },
      occupancy: {}
    }
    const turn1 = currentTurn(entry)
    const turn1Reader = service
      .openTurnStream({ sessionId: 'session-1', turnId: turn1.turnId, signal: new AbortController().signal })
      .getReader()
    await expect(turn1Reader.read()).resolves.toMatchObject({ value: { type: 'start' } })

    // Spawn tool call registers the flow anchor; children start (background occupancy on).
    handleRuntimeEvent({
      type: 'chunk',
      chunk: { type: 'tool-input-start', toolCallId: 'call-spawn', toolName: 'subagent' }
    })
    handleRuntimeEvent({
      type: 'chunk',
      chunk: {
        type: 'tool-input-available',
        toolCallId: 'call-spawn',
        toolName: 'subagent',
        input: { description: 'x' }
      }
    })
    handleRuntimeEvent({ type: 'background-work-state', active: true })
    handleRuntimeEvent({
      type: 'background-task-event',
      data: {
        event: 'started',
        taskId: 'child-1',
        toolUseId: 'call-spawn',
        status: 'in_progress',
        taskType: 'subagent'
      }
    })
    handleRuntimeEvent({
      type: 'background-tasks',
      tasks: [{ id: 'child-1', type: 'subagent', description: 'x', toolCallId: 'call-spawn' }]
    })
    handleRuntimeEvent({ type: 'turn-complete' })
    service.markTurnTerminal('session-1', 'success')

    // Between turns: detached child content patches the turn-1 row (accumulator path).
    handleRuntimeEvent({
      type: 'background-flow-chunk',
      rootToolCallId: 'call-spawn',
      chunk: { type: 'text-start', id: 'c1' }
    })
    handleRuntimeEvent({
      type: 'background-flow-chunk',
      rootToolCallId: 'call-spawn',
      chunk: { type: 'text-delta', id: 'c1', delta: 'child says hi' }
    })

    // Settlement wake: the runtime opens its own turn and starts streaming immediately.
    handleRuntimeEvent({ type: 'autonomous-turn-state', state: 'started' })
    handleRuntimeEvent({ type: 'chunk', chunk: { type: 'text-start', id: 'w1' } })
    handleRuntimeEvent({ type: 'chunk', chunk: { type: 'text-delta', id: 'w1', delta: 'wake report part 1' } })

    await vi.waitFor(() => expect(mocks.startRuntimeTurn).toHaveBeenCalledTimes(1))
    const receiveOnlyTurn = currentTurn(entry)
    expect(receiveOnlyTurn).toBeDefined()
    expect(receiveOnlyTurn.turnId).not.toBe(turn1.turnId)

    const wakeReader = service
      .openTurnStream({ sessionId: 'session-1', turnId: receiveOnlyTurn.turnId, signal: new AbortController().signal })
      .getReader()

    // More wake content + the second child settling mid-turn (work-state drops).
    handleRuntimeEvent({ type: 'chunk', chunk: { type: 'text-delta', id: 'w1', delta: ' part 2' } })
    handleRuntimeEvent({ type: 'background-work-state', active: false })
    handleRuntimeEvent({ type: 'chunk', chunk: { type: 'text-delta', id: 'w1', delta: ' part 3' } })
    handleRuntimeEvent({ type: 'chunk', chunk: { type: 'text-end', id: 'w1' } })
    handleRuntimeEvent({ type: 'autonomous-turn-state', state: 'finished' })
    handleRuntimeEvent({ type: 'turn-complete' })

    const received: any[] = []
    for (;;) {
      const { value, done } = await wakeReader.read()
      if (done) break
      received.push(value)
    }
    const deltas = received.filter((chunk) => chunk.type === 'text-delta').map((chunk) => chunk.delta)
    expect(received[0]).toMatchObject({ type: 'start' })
    expect(deltas).toEqual(['wake report part 1', ' part 2', ' part 3'])

    void service.closeSession('session-1')
  })
})
