import { defaultServiceInstances } from '@test-mocks/main/application'
import { readUIMessageStream } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Incident repro (2026-08-15): a runtime subagent settlement wake opened a
 * receive-only turn whose persisted row ended up with ZERO parts while the
 * runtime streamed a full report. Drive the real service with the incident's
 * event order and assert the receive-only stream actually carries the chunks.
 */
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
  finalizeHeldTopicStream: vi.fn(async () => undefined),
  clearPendingChannelListeners: vi.fn(),
  stashedWakeRecipientsDischarged: vi.fn(),
  retireStashedWakeTaskIds: vi.fn(),
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
      name === 'RuntimeActivityService' ? defaultServiceInstances.RuntimeActivityService : mocks.applicationGet(name)
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
  // Real-method default: no stash on the topic → the wake may carry (nothing owed anywhere).
  mocks.stashedWakeRecipientsDischarged.mockReturnValue(true)
  mocks.getAgent.mockReturnValue({ id: 'agent-1', type: 'test-runtime', model: baseTurnInput.modelId })
  mocks.applicationGet.mockImplementation((name: string) => {
    if (name === 'AiStreamManager') {
      return {
        getInteractionWindow: () => undefined,
        startRuntimeTurn: mocks.startRuntimeTurn,
        abort: mocks.abortStream,
        suspendUnadmittedRuntimeTurn: mocks.suspendUnadmittedRuntimeTurn,
        pauseRuntimeTurn: mocks.pauseRuntimeTurn,
        broadcastTopicError: mocks.broadcastTopicError,
        resolveToolApproval: mocks.resolveToolApproval,
        terminateHeldTopicStream: mocks.terminateHeldTopicStream,
        finalizeHeldTopicStream: mocks.finalizeHeldTopicStream,
        clearPendingChannelListeners: mocks.clearPendingChannelListeners,
        stashedWakeRecipientsDischarged: mocks.stashedWakeRecipientsDischarged,
        retireStashedWakeTaskIds: mocks.retireStashedWakeTaskIds
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
  it('settles the spawning reply while background work keeps running', async () => {
    const service = new AgentSessionRuntimeService()
    service.beginTurn(baseTurnInput)
    const entry = getEntry(service)
    entry.runtimeState.connection = {
      kind: 'connected',
      connection: {
        send: vi.fn(),
        close: vi.fn(),
        refreshTraceContext: vi.fn(),
        reconcile: vi.fn().mockResolvedValue('current')
      },
      occupancy: {}
    }
    const owner = currentTurn(entry)
    const emit = (event: unknown) => (service as any).handleRuntimeEvent(entry, event)
    const stream = service.openTurnStream({
      sessionId: 'session-1',
      turnId: owner.turnId,
      signal: new AbortController().signal
    })
    let final: any
    const collected = (async () => {
      for await (const message of readUIMessageStream({ stream })) final = message
    })()
    await vi.waitFor(() => expect(entry.runtimeState.execution.stream).toBe('open'))
    emit({ type: 'background-work-state', active: true })
    emit({ type: 'chunk', chunk: { type: 'text-start', id: 'text-0' } })
    emit({ type: 'chunk', chunk: { type: 'text-delta', id: 'text-0', delta: 'Delegated review' } })
    emit({ type: 'chunk', chunk: { type: 'text-end', id: 'text-0' } })
    emit({ type: 'chunk', chunk: { type: 'finish', finishReason: 'stop' } })
    // The reply ends with its own generation — detached work never holds the stream open, so the
    // user may send the next message immediately (the session stops being busy once persisted).
    emit({ type: 'turn-complete' })
    expect(entry.runtimeState.connection.occupancy).toMatchObject({ background: expect.anything() })
    await collected
    expect(final.parts.filter((part: any) => part.type === 'text').map((part: any) => part.text)).toEqual([
      'Delegated review'
    ])
    // With the spawning stream settled, a later task lifecycle edge updates the cache instead of
    // patching parts into the finished reply.
    emit({
      type: 'background-task-event',
      data: { event: 'notification', taskId: 'child-1', toolUseId: 'spawn-1', status: 'completed' }
    })
    expect(final.parts.some((part: any) => part.type === 'data-agent-task-event')).toBe(false)
    expect(mocks.cacheSetShared).toHaveBeenCalledWith(
      expect.stringContaining('task_events'),
      expect.objectContaining({ 'child-1': expect.objectContaining({ status: 'completed' }) })
    )
    expect(mocks.saveMessage).not.toHaveBeenCalled()
    // Draining the work releases the occupancy without touching any turn.
    emit({ type: 'background-work-state', active: false })
    expect(entry.runtimeState.connection.occupancy).toEqual({})
    await service.closeSession('session-1')
  })

  // A cancelled task leaves the driver's membership snapshot exactly like a completed one — REPLACE
  // semantics carry no per-task verdict — so the stash has to be told explicitly. Otherwise its
  // absence stays "discharged" forever and the NEXT completion, whatever work produced it, claims
  // the recipients: a desktop follow-up's private result would be posted to the external chat.
  it('retires the stashed obligation when a task is stopped rather than completed', async () => {
    const service = new AgentSessionRuntimeService()
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
    service.markTurnTerminal('session-1', 'success')

    const emit = (event: unknown) => (service as any).handleRuntimeEvent(entry, event)
    emit({
      type: 'background-task-event',
      data: { event: 'started', taskId: 'child-1', status: 'in_progress', taskType: 'subagent' }
    })
    // A completion owes the chat a delivery, so it must not retire anything.
    emit({
      type: 'background-task-event',
      data: { event: 'notification', taskId: 'child-2', status: 'completed' }
    })
    expect(mocks.retireStashedWakeTaskIds).not.toHaveBeenCalled()
    // A stop is a cancellation: no delivery is coming for that id.
    emit({
      type: 'background-task-event',
      data: { event: 'notification', taskId: 'child-1', status: 'stopped' }
    })
    expect(mocks.retireStashedWakeTaskIds).toHaveBeenCalledWith('agent-session:session-1', new Set(['child-1']))
    await service.closeSession('session-1')
  })

  // A FAILED task is not a cancellation: the SDK queues a parent failure notification for it, so the
  // chat still owes a delivery. Retiring the debt here dropped every recipient and the requesting
  // chat received its acknowledgment but never learned the task failed.
  it('keeps the stashed obligation when a task fails rather than being killed', async () => {
    const service = new AgentSessionRuntimeService()
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
    service.markTurnTerminal('session-1', 'success')

    const emit = (event: unknown) => (service as any).handleRuntimeEvent(entry, event)
    emit({
      type: 'background-task-event',
      data: { event: 'started', taskId: 'child-1', status: 'in_progress', taskType: 'subagent' }
    })
    emit({ type: 'background-task-event', data: { event: 'notification', taskId: 'child-1', status: 'error' } })
    expect(mocks.retireStashedWakeTaskIds).not.toHaveBeenCalled()

    // A kill is the cancellation-shaped one: no successor delivery is queued for it.
    emit({ type: 'background-task-event', data: { event: 'notification', taskId: 'child-2', status: 'killed' } })
    expect(mocks.retireStashedWakeTaskIds).toHaveBeenCalledWith('agent-session:session-1', new Set(['child-2']))
    await service.closeSession('session-1')
  })

  // The aggregate responder is frozen at the first activation: an interactive desktop task keeps it
  // while a cross-Session headless delivery's task runs and finishes first. The wake reports that
  // delivery's work, so it must run unattended — the responder describes A, not the completing task.
  it('opens the wake with the completing work’s own authority, not the retained responder', async () => {
    const service = new AgentSessionRuntimeService()
    const handleRuntimeEvent = (event: unknown) => (service as any).handleRuntimeEvent(getEntry(service), event)
    const desktopTask = { id: 'task-a', type: 'task', description: 'desktop work' }

    // Desktop turn: its background task A is interactive and holds the responder.
    service.beginTurn(baseTurnInput)
    const entry = getEntry(service)
    entry.runtimeState.connection = {
      kind: 'connected',
      connection: { send: vi.fn(), close: vi.fn(), events: [], reconcile: vi.fn() },
      occupancy: {}
    }
    handleRuntimeEvent({ type: 'background-tasks', tasks: [desktopTask] })
    handleRuntimeEvent({ type: 'background-work-state', active: true })
    service.markTurnTerminal('session-1', 'success')

    // A cross-Session headless delivery reuses the connection and launches B.
    service.beginTurn({ ...baseTurnInput, headless: true })
    handleRuntimeEvent({
      type: 'background-tasks',
      tasks: [desktopTask, { id: 'task-b', type: 'task', description: 'delivery work' }]
    })
    service.markTurnTerminal('session-1', 'success')
    expect(getEntry(service).runtimeState.connection.occupancy).toEqual({ background: { responder: 'interactive' } })

    // B completes first; A is still running.
    handleRuntimeEvent({ type: 'background-tasks', tasks: [desktopTask] })
    handleRuntimeEvent({ type: 'autonomous-turn-state', state: 'started', origin: { kind: 'background-work' } })
    await vi.waitFor(() => expect(mocks.startRuntimeTurn).toHaveBeenCalledTimes(1))

    expect(currentTurn(getEntry(service)).headless).toBe(true)
    void service.closeSession('session-1')
  })

  it('keeps a desktop task’s completion wake interactive', async () => {
    const service = new AgentSessionRuntimeService()
    const handleRuntimeEvent = (event: unknown) => (service as any).handleRuntimeEvent(getEntry(service), event)

    service.beginTurn(baseTurnInput)
    const entry = getEntry(service)
    entry.runtimeState.connection = {
      kind: 'connected',
      connection: { send: vi.fn(), close: vi.fn(), events: [], reconcile: vi.fn() },
      occupancy: {}
    }
    handleRuntimeEvent({ type: 'background-tasks', tasks: [{ id: 'task-a', type: 'task', description: 'desktop' }] })
    handleRuntimeEvent({ type: 'background-work-state', active: true })
    service.markTurnTerminal('session-1', 'success')

    handleRuntimeEvent({ type: 'background-tasks', tasks: [] })
    handleRuntimeEvent({ type: 'autonomous-turn-state', state: 'started', origin: { kind: 'background-work' } })
    await vi.waitFor(() => expect(mocks.startRuntimeTurn).toHaveBeenCalledTimes(1))

    expect(currentTurn(getEntry(service)).headless).toBe(false)
    void service.closeSession('session-1')
  })

  // A headless completion delivered into a live desktop turn is consumed there: it never opens a
  // wake of its own. Keeping its authority owed made a LATER interactive completion's wake run
  // headless, denying the user's questions and approvals for work the desktop requested.
  it('does not let a headless completion consumed by a desktop turn deny a later interactive wake', async () => {
    const service = new AgentSessionRuntimeService()
    const handleRuntimeEvent = (event: unknown) => (service as any).handleRuntimeEvent(getEntry(service), event)

    // A headless delivery spawns task A and settles; A keeps running.
    service.beginTurn({ ...baseTurnInput, headless: true })
    const entry = getEntry(service)
    entry.runtimeState.connection = {
      kind: 'connected',
      connection: { send: vi.fn(), close: vi.fn(), events: [], reconcile: vi.fn() },
      occupancy: {}
    }
    handleRuntimeEvent({ type: 'background-tasks', tasks: [{ id: 'task-a', type: 'task', description: 'delivery' }] })
    handleRuntimeEvent({ type: 'background-work-state', active: true })
    service.markTurnTerminal('session-1', 'success')

    // A running desktop turn is streaming when A's notification arrives: that generation consumes
    // it, so no wake will ever report it.
    service.beginTurn(baseTurnInput)
    const desktopTurn = currentTurn(entry)
    const desktopReader = service
      .openTurnStream({ sessionId: 'session-1', turnId: desktopTurn.turnId, signal: new AbortController().signal })
      .getReader()
    await expect(desktopReader.read()).resolves.toMatchObject({ value: { type: 'start' } })
    handleRuntimeEvent({ type: 'background-tasks', tasks: [] })
    handleRuntimeEvent({ type: 'background-work-state', active: false })
    service.markTurnTerminal('session-1', 'success')
    await desktopReader.cancel().catch(() => undefined)

    // A later desktop turn's own task completes with no generation left to consume it, so its
    // completion wakes the agent.
    service.beginTurn(baseTurnInput)
    handleRuntimeEvent({ type: 'background-tasks', tasks: [{ id: 'task-c', type: 'task', description: 'desktop' }] })
    service.markTurnTerminal('session-1', 'success')
    handleRuntimeEvent({ type: 'background-tasks', tasks: [] })
    handleRuntimeEvent({ type: 'autonomous-turn-state', state: 'started', origin: { kind: 'background-work' } })
    await vi.waitFor(() => expect(mocks.startRuntimeTurn).toHaveBeenCalledTimes(1))

    expect(currentTurn(getEntry(service)).headless).toBe(false)
    expect(service.getInteractionState('session-1')).toMatchObject({
      currentTurn: 'interactive',
      userResponse: 'message'
    })
    void service.closeSession('session-1')
  })

  // A completion drained into a desktop reply is paid to that reply. Leaving it in the external
  // chat's stashed debt let a later private wake claim the recipients and post desktop output there.
  it('retires a completion consumed by a desktop turn from the chat’s stashed debt', async () => {
    const service = new AgentSessionRuntimeService()
    const handleRuntimeEvent = (event: unknown) => (service as any).handleRuntimeEvent(getEntry(service), event)

    // A scheduled fire spawns A beside a long-lived server task S, which keeps work alive.
    service.beginTurn({ ...baseTurnInput, headless: true })
    const entry = getEntry(service)
    entry.runtimeState.connection = {
      kind: 'connected',
      connection: { send: vi.fn(), close: vi.fn(), events: [], reconcile: vi.fn() },
      occupancy: {}
    }
    handleRuntimeEvent({
      type: 'background-tasks',
      tasks: [
        { id: 'task-a', type: 'task', description: 'fire' },
        { id: 'task-server', type: 'task', description: 'server' }
      ]
    })
    handleRuntimeEvent({ type: 'background-work-state', active: true })
    service.markTurnTerminal('session-1', 'success')

    // A desktop generation is streaming when A settles: that reply consumes A, no wake reports it.
    service.beginTurn(baseTurnInput)
    const desktopTurn = currentTurn(entry)
    const desktopReader = service
      .openTurnStream({ sessionId: 'session-1', turnId: desktopTurn.turnId, signal: new AbortController().signal })
      .getReader()
    await expect(desktopReader.read()).resolves.toMatchObject({ value: { type: 'start' } })
    handleRuntimeEvent({
      type: 'background-tasks',
      tasks: [{ id: 'task-server', type: 'task', description: 'server' }]
    })

    expect(mocks.retireStashedWakeTaskIds).toHaveBeenCalledWith('agent-session:session-1', new Set(['task-a']))
    void service.closeSession('session-1')
  })

  // A connection-wide ledger of every id the session ever published made an EARLIER fire's
  // completed task count as debt for a later one. That task's absence then "discharged" the new
  // stash, so an unrelated desktop task's wake claimed the external chat and posted its output
  // there. Debt is only what the CURRENT turn still owes.
  it('does not carry an earlier turn’s completed task into the next fire’s debt', () => {
    const service = new AgentSessionRuntimeService()
    service.beginTurn(baseTurnInput)
    const entry = getEntry(service)
    const emit = (event: unknown) => (service as any).handleRuntimeEvent(entry, event)

    emit({ type: 'background-tasks', tasks: [{ id: 'task-a', type: 'task', description: 'A' }] })
    // A settles under this turn — the retaining caller's terminal can land after the drain.
    emit({ type: 'background-tasks', tasks: [] })
    expect(service.listPublishedBackgroundTaskIds('session-1')).toEqual(new Set(['task-a']))

    service.markTurnTerminal('session-1', 'success')
    // The retaining caller's terminal can land after the runtime advanced past the turn.
    expect(service.listPublishedBackgroundTaskIds('session-1')).toEqual(new Set(['task-a']))
    // A later fire on the same warm connection starts its own work.
    service.beginTurn(baseTurnInput)
    emit({ type: 'background-tasks', tasks: [{ id: 'task-b', type: 'task', description: 'B' }] })

    expect(service.listPublishedBackgroundTaskIds('session-1')).toEqual(new Set(['task-b']))
    void service.closeSession('session-1')
  })

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
    handleRuntimeEvent({ type: 'autonomous-turn-state', state: 'started', origin: { kind: 'background-work' } })
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

  it('lets a settlement wake carry the channel listeners an ordinary successor turn would drop', async () => {
    const service = new AgentSessionRuntimeService()
    const handleRuntimeEvent = (event: unknown) => (service as any).handleRuntimeEvent(getEntry(service), event)

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
    const reader = service
      .openTurnStream({
        sessionId: 'session-1',
        turnId: currentTurn(entry).turnId,
        signal: new AbortController().signal
      })
      .getReader()
    await expect(reader.read()).resolves.toMatchObject({ value: { type: 'start' } })

    handleRuntimeEvent({ type: 'background-work-state', active: true })
    handleRuntimeEvent({ type: 'turn-complete' })
    service.markTurnTerminal('session-1', 'success')

    handleRuntimeEvent({ type: 'autonomous-turn-state', state: 'started', origin: { kind: 'background-work' } })
    await vi.waitFor(() => expect(mocks.startRuntimeTurn).toHaveBeenCalledTimes(1))

    // The wake is the delivery route for the background work's result: it must opt into carrying
    // the topic's IM-channel listeners (the stream manager drops them for ordinary successors).
    expect(mocks.startRuntimeTurn).toHaveBeenCalledWith(expect.objectContaining({ carryChannelListeners: true }))

    handleRuntimeEvent({ type: 'chunk', chunk: { type: 'text-end', id: 'w1' } })
    handleRuntimeEvent({ type: 'autonomous-turn-state', state: 'finished' })
    handleRuntimeEvent({ type: 'turn-complete' })
    void service.closeSession('session-1')
  })

  // The stash is bound to the tasks its fire saw pending — not to session-wide emptiness. A wake
  // whose owing tasks have left the driver's live set claims the recipients even while ANOTHER
  // fire's unrelated task is still listed; the old session-wide emptiness rule stranded A's
  // delivery and let B's later wake post B's output to A's external chats.
  it('claims the stashed recipients once the owed task ids leave the driver’s live set', async () => {
    const service = new AgentSessionRuntimeService()
    const handleRuntimeEvent = (event: unknown) => (service as any).handleRuntimeEvent(getEntry(service), event)

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
    const reader = service
      .openTurnStream({
        sessionId: 'session-1',
        turnId: currentTurn(entry).turnId,
        signal: new AbortController().signal
      })
      .getReader()
    await expect(reader.read()).resolves.toMatchObject({ value: { type: 'start' } })

    handleRuntimeEvent({ type: 'background-work-state', active: true })
    handleRuntimeEvent({ type: 'turn-complete' })
    service.markTurnTerminal('session-1', 'success')

    // The driver now lists another fire's detached task; this wake's own owed task has drained.
    mocks.cacheGetShared.mockReturnValue([{ id: 'task-b', type: 'task', description: 'Another fire’s work' }])
    mocks.stashedWakeRecipientsDischarged.mockReturnValue(true)

    handleRuntimeEvent({ type: 'autonomous-turn-state', state: 'started', origin: { kind: 'background-work' } })
    await vi.waitFor(() => expect(mocks.startRuntimeTurn).toHaveBeenCalledTimes(1))

    // The claim question is asked of the stash itself, against the driver's live set.
    expect(mocks.stashedWakeRecipientsDischarged).toHaveBeenCalledWith('agent-session:session-1', new Set(['task-b']))
    expect(mocks.startRuntimeTurn).toHaveBeenCalledWith(expect.objectContaining({ carryChannelListeners: true }))
    void service.closeSession('session-1')
  })

  it('withholds the claim while the stash’s own owed tasks are still listed', async () => {
    const service = new AgentSessionRuntimeService()
    const handleRuntimeEvent = (event: unknown) => (service as any).handleRuntimeEvent(getEntry(service), event)

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
    const reader = service
      .openTurnStream({
        sessionId: 'session-1',
        turnId: currentTurn(entry).turnId,
        signal: new AbortController().signal
      })
      .getReader()
    await expect(reader.read()).resolves.toMatchObject({ value: { type: 'start' } })

    handleRuntimeEvent({ type: 'background-work-state', active: true })
    handleRuntimeEvent({ type: 'turn-complete' })
    service.markTurnTerminal('session-1', 'success')

    // The stash's own work is still pending — the wake delivering a different task's result must
    // not claim (or strand) the recipients.
    mocks.cacheGetShared.mockReturnValue([{ id: 'task-a', type: 'task', description: 'The fire’s own work' }])
    mocks.stashedWakeRecipientsDischarged.mockReturnValue(false)

    handleRuntimeEvent({ type: 'autonomous-turn-state', state: 'started', origin: { kind: 'background-work' } })
    await vi.waitFor(() => expect(mocks.startRuntimeTurn).toHaveBeenCalledTimes(1))

    expect(mocks.startRuntimeTurn).not.toHaveBeenCalledWith(expect.objectContaining({ carryChannelListeners: true }))
    void service.closeSession('session-1')
  })

  it('still acknowledges persistence for a turn whose execution a wake replaced mid-settle', async () => {
    const service = new AgentSessionRuntimeService()
    const handle = service.beginTurn(baseTurnInput)
    const terminalListener = (handle.listeners as any[]).find((listener) => listener.id === 'agent-runtime:session-1')!
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
    const handleRuntimeEvent = (event: unknown) => (service as any).handleRuntimeEvent(entry, event)
    const turn1 = currentTurn(entry)
    const reader = service
      .openTurnStream({ sessionId: 'session-1', turnId: turn1.turnId, signal: new AbortController().signal })
      .getReader()
    await expect(reader.read()).resolves.toMatchObject({ value: { type: 'start' } })

    handleRuntimeEvent({
      type: 'chunk',
      chunk: { type: 'tool-input-start', toolCallId: 'call-spawn', toolName: 'subagent' }
    })
    handleRuntimeEvent({
      type: 'chunk',
      chunk: { type: 'tool-input-available', toolCallId: 'call-spawn', toolName: 'subagent', input: {} }
    })
    handleRuntimeEvent({ type: 'background-work-state', active: true })
    handleRuntimeEvent({ type: 'turn-complete' })
    expect(entry.runtimeState.execution.kind).toBe('turn')
    expect(entry.runtimeState.execution.stream).toBe('awaiting-persistence')

    // The child streams while the turn's row has not been acknowledged as persisted yet, so its
    // chunks park in pendingBackgroundFlowChunks.
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
    handleRuntimeEvent({
      type: 'background-flow-chunk',
      rootToolCallId: 'call-spawn',
      chunk: { type: 'text-end', id: 'c1' }
    })

    // The settlement wake lands while the spawning turn still awaits channel terminal delivery, so
    // the awaiting-persistence execution is not live and the wake replaces it outright.
    handleRuntimeEvent({ type: 'autonomous-turn-state', state: 'started', origin: { kind: 'background-work' } })
    expect(entry.runtimeState.execution.kind).toBe('autonomous-turn')

    // The turn's own terminal callback runs after persistence completed (persistence listeners are
    // awaited first in the terminal dispatch): the parked child chunks must be released into the
    // flow accumulator and persist, even though the execution transition stays guarded.
    terminalListener.onDone()
    handleRuntimeEvent({ type: 'background-work-state', active: false })
    await (service as any).finishBackgroundFlows(entry)

    expect(mocks.replaceMessageParts).toHaveBeenCalledWith('session-1', 'assistant-1', [
      expect.objectContaining({ type: 'text', text: 'child says hi' })
    ])
    expect(entry.pendingBackgroundFlowChunks?.get('assistant-1')).toBeUndefined()

    void service.closeSession('session-1')
  })

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
    const handleRuntimeEvent = (event: unknown) => (service as any).handleRuntimeEvent(getEntry(service), event)

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
    handleRuntimeEvent({ type: 'chunk', chunk: { type: 'text-start', id: 'w1' } })

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

    handleRuntimeEvent({ type: 'chunk', chunk: { type: 'text-end', id: 'w1' } })
    handleRuntimeEvent({ type: 'autonomous-turn-state', state: 'finished' })
    handleRuntimeEvent({ type: 'turn-complete' })
    void service.closeSession('session-1')
  })

  // Canceling the session's runtime kills its detached background work, so the wake that owed the
  // stashed channel recipients their delivery can never come — closing the session must release
  // the binding, or a later unrelated wake on the topic would post to the old external chats.
  it('releases the stashed wake recipients when the session runtime closes', async () => {
    const service = new AgentSessionRuntimeService()
    const handleRuntimeEvent = (event: unknown) => (service as any).handleRuntimeEvent(getEntry(service), event)

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
    handleRuntimeEvent({ type: 'background-work-state', active: true })
    expect(entry.runtimeState.connection.occupancy).toMatchObject({ background: expect.anything() })

    await service.closeSession('session-1')

    expect(mocks.clearPendingChannelListeners).toHaveBeenCalledWith('agent-session:session-1')
  })
})
