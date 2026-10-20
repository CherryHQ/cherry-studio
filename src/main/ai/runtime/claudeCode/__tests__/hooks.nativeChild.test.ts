import type { HookCallback, HookJSONOutput } from '@anthropic-ai/claude-agent-sdk'
import { defaultServiceInstances } from '@test-mocks/main/application'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { toCherryBuiltinRuntimeName } from '@main/ai/toolApproval/builtinToolPolicy'
import { SESSION_SEND_TOOL_NAME } from '@shared/ai/agentSessionDelivery'
import { CONFIG_TOOL_NAME } from '@shared/ai/builtinTools'
import type { UniqueModelId } from '@shared/data/types/model'

/**
 * The overlap the headless boundary has to survive in the NATIVE Claude runtime.
 *
 * A headless turn spawns a Task subagent and settles while that child is still running; a desktop
 * follow-up then starts on the SAME root Session id. Every call the child makes afterwards arrives
 * under that shared root id, and the SDK names the child only by `agent_id` — so resolving the guard
 * by session id alone credits the child with the follow-up's interactive turn and lets an
 * auto-approved tool like `remove_channel` execute without fresh approval.
 *
 * Driven against the real AgentSessionRuntimeService so the binding, the binding's timing and the
 * guard lookup are all the production ones — a stubbed resolver would pass whatever it was told.
 */
const { state, aiStreamManager, windowManager, cacheService, warmQueryManager, analyticsService } = vi.hoisted(() => {
  // Real queue semantics: the spawn-call attribution is what tells `SubagentStart` who launched a
  // child, so the fake has to carry it between the two hooks like the real service does.
  const state = {
    spawnAttempts: [] as { toolUseId: string; parentAgentId?: string }[],
    getToolPolicySnapshot: vi.fn(),
    getBashNoProgressRun: vi.fn(),
    getSteerHolder: vi.fn(),
    disposeBashScope: vi.fn(),
    recordNativeSpawnAttempt: vi.fn((_sessionId: string, toolUseId: string, parentAgentId?: string) => {
      state.spawnAttempts.push({ toolUseId, ...(parentAgentId ? { parentAgentId } : {}) })
    }),
    takeNativeSpawnAttempt: vi.fn(() => state.spawnAttempts.shift()),
    clearNativeSpawnAttempt: vi.fn((_sessionId: string, toolUseId: string) => {
      const index = state.spawnAttempts.findIndex((attempt) => attempt.toolUseId === toolUseId)
      if (index >= 0) state.spawnAttempts.splice(index, 1)
    })
  }
  return {
    state,
    aiStreamManager: {
      startRuntimeTurn: vi.fn(),
      getInteractionWindow: vi.fn(),
      abort: vi.fn(),
      suspendUnadmittedRuntimeTurn: vi.fn().mockResolvedValue(undefined),
      pauseRuntimeTurn: vi.fn(),
      broadcastTopicError: vi.fn(),
      resolveToolApproval: vi.fn(),
      terminateHeldTopicStream: vi.fn(),
      finalizeHeldTopicStream: vi.fn(async () => undefined),
      clearPendingChannelListeners: vi.fn()
    },
    // Explicit return type: `vi.fn(() => undefined)` would pin the mock to `undefined` and leave no
    // way to stand in for a live window. Callers only test the handle for existence.
    windowManager: { getWindow: vi.fn((): object | undefined => undefined) },
    cacheService: { setShared: vi.fn(), getShared: vi.fn(), deleteShared: vi.fn() },
    warmQueryManager: { closeAll: vi.fn().mockResolvedValue(undefined), closeAgentSessionWarm: vi.fn() },
    analyticsService: { trackTokenUsage: vi.fn() }
  }
})

vi.mock('@application', () => ({
  application: {
    get: vi.fn((name: string) => {
      switch (name) {
        case 'ClaudeCodeSessionStateService':
          return state
        case 'AiStreamManager':
          return aiStreamManager
        case 'WindowManager':
          return windowManager
        case 'CacheService':
          return cacheService
        case 'ClaudeCodeWarmQueryManager':
          return warmQueryManager
        case 'AnalyticsService':
          return analyticsService
        // The runtime service syncs its activity hold on every turn boundary (upstream).
        case 'RuntimeActivityService':
          return defaultServiceInstances.RuntimeActivityService
        case 'AgentSessionRuntimeService':
          return serviceInstance.service
        default:
          throw new Error(`Unexpected application.get(${name})`)
      }
    }),
    getPath: vi.fn((key: string, filename?: string) => (filename ? `/mock/${key}/${filename}` : `/mock/${key}`))
  },
  serviceList: []
}))

vi.mock('../skillDependencies', () => ({
  SKILL_TOOL_NAME: 'Skill',
  checkSkillRuntimeDependencies: vi.fn(async () => ({}))
}))

vi.mock('@main/ai/toolApproval/userDataSqliteGuard', () => ({
  USER_DATA_SQLITE_GUARD_REASON: 'Access to SQLite files inside Cherry Studio user data is blocked.',
  evaluateUserDataSqliteGuard: vi.fn(async () => undefined)
}))

vi.mock('@data/services/AgentSessionService', () => ({
  agentSessionService: { getById: vi.fn(() => ({ agentId: 'agent-1' })), ensureTraceId: vi.fn(() => 'b'.repeat(32)) }
}))

vi.mock('@data/services/AgentService', () => ({
  agentService: {
    getAgent: vi.fn(() => ({ id: 'agent-1', type: 'test-runtime', model: MODEL_ID })),
    onAgentUpdated: () => () => {}
  }
}))

vi.mock('@data/services/AgentSessionMessageService', () => ({
  agentSessionMessageService: {
    saveMessage: vi.fn(),
    replaceMessageParts: vi.fn(),
    getSessionMessage: vi.fn(),
    hasSessionMessage: vi.fn(() => true),
    applyToolApprovalDecision: vi.fn(() => true),
    getLastRuntimeResumeToken: vi.fn(() => null),
    getNativeSessionId: vi.fn(() => undefined),
    findCrashOrphanedAssistantMessages: vi.fn(() => []),
    resolveCrashOrphanedMessages: vi.fn()
  }
}))

vi.mock('@data/services/AiUsageRecordService', () => ({
  aiUsageRecordService: { recordInvocation: vi.fn() }
}))

import { AgentSessionRuntimeService } from '@main/ai/agentSession/AgentSessionRuntimeService'
import { BaseService } from '@main/core/lifecycle/BaseService'

import { buildClaudeCodeHooks } from '../hooks'

const SESSION_ID = 'session-native-overlap'
const MODEL_ID = 'test-runtime::model-1' as UniqueModelId
const CONFIG_TOOL = toCherryBuiltinRuntimeName(CONFIG_TOOL_NAME)
const NATIVE_CHILD = 'child-native-1'
const SESSION_SEND_TOOL = toCherryBuiltinRuntimeName(SESSION_SEND_TOOL_NAME)

/** Late-bound so the mock factory can hand the same instance to `application.get`. */
const serviceInstance: { service: AgentSessionRuntimeService } = { service: undefined as never }

function runtime(): AgentSessionRuntimeService {
  return serviceInstance.service
}

/** One turn that owns the entry. */
function beginTurn(headless = false): void {
  runtime().beginTurn({
    sessionId: SESSION_ID,
    topicId: `topic-${SESSION_ID}`,
    agentId: 'agent-1',
    agentType: 'test-runtime',
    modelId: MODEL_ID,
    userMessage: { id: 'msg-1', data: { parts: [{ type: 'text', text: 'go' }] } } as never,
    assistantMessageId: 'assistant-1',
    traceId: 'a'.repeat(32),
    ...(headless ? { headless: true } : {})
  })
}

function settleTurn(): void {
  runtime().markTurnTerminal(SESSION_ID, 'success')
}

function hook(kind: 'PreToolUse' | 'PostToolUse' | 'SubagentStart' | 'SubagentStop', index = 0): HookCallback {
  const table = buildClaudeCodeHooks({
    sessionId: SESSION_ID,
    cwd: '/tmp',
    agentDataPath: '/tmp',
    builtinRole: undefined,
    mountedServers: new Set(['cherry-tools']),
    pluginDirectories: new Map(),
    supportsImages: false
  })
  const [matcher] = table?.[kind] ?? []
  const found = matcher?.hooks?.[index]
  if (!found) throw new Error(`no ${kind} hook at ${index}`)
  return found
}

/** The tool call ended without starting a child (PostToolUse carries the same tool_use_id). */
async function settleToolCall(toolName: string): Promise<void> {
  // PostToolUse hooks are [postToolTimingHook, bashOutcomeHook, spawnAttemptCleanupHook].
  await hook('PostToolUse', 2)(
    { hook_event_name: 'PostToolUse', tool_name: toolName, tool_use_id: 'tool-use-1', duration_ms: 1 } as never,
    'tool-use-1',
    { signal: new AbortController().signal }
  )
}

async function fireGuard(payload: Record<string, unknown>): Promise<HookJSONOutput> {
  return hook('PreToolUse')(
    {
      hook_event_name: 'PreToolUse',
      tool_name: CONFIG_TOOL,
      tool_input: { action: 'remove_channel' },
      ...payload
    } as never,
    'tool-use-1',
    { signal: new AbortController().signal }
  )
}

function decisionOf(out: HookJSONOutput): { permissionDecision?: string; permissionDecisionReason?: string } {
  return (
    (out as { hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string } })
      .hookSpecificOutput ?? {}
  )
}

beforeEach(async () => {
  vi.clearAllMocks()
  state.getToolPolicySnapshot.mockReturnValue(undefined)
  state.getBashNoProgressRun.mockReturnValue(undefined)
  state.getSteerHolder.mockReturnValue({ pending: [] })
  cacheService.getShared.mockReturnValue(undefined)
  state.spawnAttempts.length = 0
  // The binding under test lives on the service's entry, so each test gets a fresh real instance
  // (the lifecycle guard forbids more than one at a time).
  BaseService.resetInstances()
  serviceInstance.service = new AgentSessionRuntimeService()
})

describe('native Claude child authority across a desktop follow-up', () => {
  it('keeps the headless-spawned child denied while the follow-up itself stays interactive', async () => {
    // 1. Headless turn spawns the child and settles; the child is still running.
    beginTurn(true)
    await hook('SubagentStart')(
      { hook_event_name: 'SubagentStart', agent_id: NATIVE_CHILD, agent_type: 'general-purpose' } as never,
      undefined,
      { signal: new AbortController().signal }
    )
    settleTurn()

    // 2. Desktop follow-up takes the entry; the session-level view is interactive again.
    beginTurn(false)
    expect(decisionOf(await fireGuard({})).permissionDecision).toBeUndefined()

    // 3. The child's own call must still resolve headless — the actual regression.
    const childDecision = decisionOf(await fireGuard({ agent_id: NATIVE_CHILD }))
    expect(childDecision.permissionDecision).toBe('deny')
    expect(childDecision.permissionDecisionReason).toContain('cannot mutate agent configuration')
  })

  // The inverse direction, and what stops the fix from being a blanket denial: a child spawned by
  // an INTERACTIVE turn keeps interactive authority after a headless delivery takes the entry
  // (falling back to the session state alone would report headless and deny a legitimate child).
  it('leaves an interactively spawned child interactive under a later headless turn', async () => {
    beginTurn(false)
    await hook('SubagentStart')(
      { hook_event_name: 'SubagentStart', agent_id: NATIVE_CHILD, agent_type: 'general-purpose' } as never,
      undefined,
      { signal: new AbortController().signal }
    )
    settleTurn()

    // The headless delivery now owns the entry — session-level resolution alone reports headless.
    beginTurn(true)
    expect(runtime().getInteractionState(SESSION_ID).currentTurn).toBe('headless')

    // The interactively spawned child is not dragged down with it.
    expect(decisionOf(await fireGuard({ agent_id: NATIVE_CHILD })).permissionDecision).toBeUndefined()
  })

  it('fails closed for a child whose spawn was never announced', async () => {
    beginTurn(false)
    expect(decisionOf(await fireGuard({ agent_id: 'unannounced-child' })).permissionDecision).toBe('deny')
  })

  // Live membership is not parentage: the spawn call names the parent (`agent_id` of the caller,
  // absent on the main thread). A desktop follow-up's own child must not inherit an unrelated
  // headless child's denial just because both are running on the shared connection.
  it('binds a child to the execution whose spawn call launched it', async () => {
    beginTurn(true)
    await hook('SubagentStart')(
      { hook_event_name: 'SubagentStart', agent_id: NATIVE_CHILD, agent_type: 'general-purpose' } as never,
      undefined,
      { signal: new AbortController().signal }
    )
    settleTurn()

    // The desktop follow-up owns the entry while A is still live; the MAIN THREAD spawns B.
    beginTurn(false)
    await fireGuard({
      tool_name: 'Task',
      tool_input: { description: 'B', prompt: 'go', subagent_type: 'general-purpose' }
    })
    await hook('SubagentStart')(
      { hook_event_name: 'SubagentStart', agent_id: 'child-of-desktop', agent_type: 'general-purpose' } as never,
      undefined,
      { signal: new AbortController().signal }
    )

    expect(decisionOf(await fireGuard({ agent_id: 'child-of-desktop' })).permissionDecision).toBeUndefined()
    // The unrelated headless child keeps its own denial.
    expect(decisionOf(await fireGuard({ agent_id: NATIVE_CHILD })).permissionDecision).toBe('deny')
  })

  // The other direction of the same provenance: a grandchild launched from INSIDE the headless
  // child stays unattended even though the desktop follow-up owns the session when it starts.
  it('keeps a grandchild of the headless child unattended', async () => {
    beginTurn(true)
    await hook('SubagentStart')(
      { hook_event_name: 'SubagentStart', agent_id: NATIVE_CHILD, agent_type: 'general-purpose' } as never,
      undefined,
      { signal: new AbortController().signal }
    )
    settleTurn()

    beginTurn(false)
    // The headless child issues the spawn call — its `agent_id` is the parent.
    await fireGuard({
      tool_name: 'Task',
      agent_id: NATIVE_CHILD,
      tool_input: { description: 'C', prompt: 'go', subagent_type: 'general-purpose' }
    })
    await hook('SubagentStart')(
      { hook_event_name: 'SubagentStart', agent_id: 'grandchild', agent_type: 'general-purpose' } as never,
      undefined,
      { signal: new AbortController().signal }
    )

    expect(decisionOf(await fireGuard({ agent_id: 'grandchild' })).permissionDecision).toBe('deny')
  })

  // A skill declared `context: fork` launches its descendant through the Skill tool (SDK 0.3.284),
  // not Task/Agent. The Skill call is therefore the spawn record — without it the forked descendant
  // binds to the desktop follow-up that merely happens to own the session.
  it('binds a context-fork skill’s descendant to the execution that invoked it', async () => {
    beginTurn(true)
    await hook('SubagentStart')(
      { hook_event_name: 'SubagentStart', agent_id: NATIVE_CHILD, agent_type: 'general-purpose' } as never,
      undefined,
      { signal: new AbortController().signal }
    )
    settleTurn()

    beginTurn(false)
    // The headless child invokes a forked skill: its `agent_id` is the parent.
    await fireGuard({ tool_name: 'Skill', agent_id: NATIVE_CHILD, tool_input: { skill: 'forked-review' } })
    await hook('SubagentStart')(
      { hook_event_name: 'SubagentStart', agent_id: 'forked-child', agent_type: 'general-purpose' } as never,
      undefined,
      { signal: new AbortController().signal }
    )

    expect(decisionOf(await fireGuard({ agent_id: 'forked-child' })).permissionDecision).toBe('deny')
  })

  // A plain skill invocation starts nothing. Its attribution must not survive to claim the next
  // spawn, which would drag the follow-up's own interactive child under the old headless denial.
  it('drops a skill call that spawned no child', async () => {
    beginTurn(true)
    await hook('SubagentStart')(
      { hook_event_name: 'SubagentStart', agent_id: NATIVE_CHILD, agent_type: 'general-purpose' } as never,
      undefined,
      { signal: new AbortController().signal }
    )
    settleTurn()

    beginTurn(false)
    await fireGuard({ tool_name: 'Skill', agent_id: NATIVE_CHILD, tool_input: { skill: 'plain' } })
    await settleToolCall('Skill')
    await hook('SubagentStart')(
      { hook_event_name: 'SubagentStart', agent_id: 'child-of-desktop', agent_type: 'general-purpose' } as never,
      undefined,
      { signal: new AbortController().signal }
    )

    expect(decisionOf(await fireGuard({ agent_id: 'child-of-desktop' })).permissionDecision).toBeUndefined()
  })

  // The cross-Session tools are the other class an unattended child must not reach. These are also
  // the ones the MCP resolution denies separately: session_send/session_create carry the always-on
  // ('required','enforce') approval, so headless calls are denied rather than merely asked.
  it('denies the child cross-Session delegation while the desktop turn may still ask', async () => {
    beginTurn(true)
    await hook('SubagentStart')(
      { hook_event_name: 'SubagentStart', agent_id: NATIVE_CHILD, agent_type: 'general-purpose' } as never,
      undefined,
      { signal: new AbortController().signal }
    )
    settleTurn()
    beginTurn(false)

    const childDecision = decisionOf(await fireGuard({ agent_id: NATIVE_CHILD, tool_name: SESSION_SEND_TOOL }))
    expect(childDecision.permissionDecision).toBe('deny')
    expect(childDecision.permissionDecisionReason).toContain('no interactive responder')

    // The desktop turn only has to ask — its own interactive turn is untouched by the fix.
    expect(decisionOf(await fireGuard({ tool_name: SESSION_SEND_TOOL })).permissionDecision).toBe('ask')
  })

  // SubagentStop is not an authoritative termination for the BINDING: the consumed SDK (0.3.284)
  // explicitly lets a SubagentStop hook continue the same child via additionalContext, so the
  // provenance must survive for a resumed child's own `agent_id` calls. Liveness is tracked
  // separately: once the child has stopped, an unattributed call is the follow-up's own.
  it('keeps a stopped child’s provenance while releasing its liveness', async () => {
    beginTurn(true)
    await hook('SubagentStart')(
      { hook_event_name: 'SubagentStart', agent_id: NATIVE_CHILD, agent_type: 'general-purpose' } as never,
      undefined,
      { signal: new AbortController().signal }
    )
    await hook('SubagentStop')(
      { hook_event_name: 'SubagentStop', agent_id: NATIVE_CHILD, agent_type: 'general-purpose' } as never,
      undefined,
      { signal: new AbortController().signal }
    )
    settleTurn()

    // Desktop follow-up takes the entry.
    beginTurn(false)
    // The child's own calls still resolve by its bound origin.
    expect(runtime().getSessionToolsAuthorization(SESSION_ID, NATIVE_CHILD)).toMatchObject({
      currentTurn: 'headless',
      userResponse: 'unavailable'
    })
    // No live child remains, so an unattributed call belongs to the follow-up's interactive turn.
    expect(runtime().getSessionToolsAuthorization(SESSION_ID)).toMatchObject({ currentTurn: 'interactive' })
  })

  // The historical binding must not be revived by unrelated work: a desktop follow-up starting an
  // ordinary background Bash server re-activates the connection's background slot, but that server
  // says nothing about whether the OLD headless child is still running.
  it('does not revive a drained child’s headless denial when unrelated background work starts', async () => {
    beginTurn(true)
    await hook('SubagentStart')(
      { hook_event_name: 'SubagentStart', agent_id: NATIVE_CHILD, agent_type: 'general-purpose' } as never,
      undefined,
      { signal: new AbortController().signal }
    )
    await hook('SubagentStop')(
      { hook_event_name: 'SubagentStop', agent_id: NATIVE_CHILD, agent_type: 'general-purpose' } as never,
      undefined,
      { signal: new AbortController().signal }
    )
    settleTurn()

    beginTurn(false)
    const entry = (runtime() as unknown as { entries: Map<string, any> }).entries.get(SESSION_ID)
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
    ;(runtime() as any).handleRuntimeEvent(entry, { type: 'background-work-state', active: true })
    aiStreamManager.getInteractionWindow.mockReturnValue('window-1')
    windowManager.getWindow.mockReturnValue({})

    // The follow-up keeps its own interactive authorization and consent host.
    expect(runtime().getSessionToolsAuthorization(SESSION_ID)).toMatchObject({ currentTurn: 'interactive' })
    expect(runtime().getMcpInteractionHost(SESSION_ID)).toMatchObject({ windowId: 'window-1' })
    // Provenance still names the drained child, so its own calls stay headless.
    expect(runtime().getSessionToolsAuthorization(SESSION_ID, NATIVE_CHILD)).toMatchObject({
      currentTurn: 'headless',
      userResponse: 'unavailable'
    })
  })

  // SubagentStop alone is not authoritative: the pinned SDK (0.3.284) lets ANOTHER SubagentStop hook
  // continue the same child via additionalContext, so a "stopped" child can still issue MCP calls —
  // and those carry no bridgeOrigin, so only this membership separates them from the desktop
  // follow-up's interactive authority. While the follow-up's own background server keeps the shared
  // responder busy, the stop must not release the restriction.
  it('keeps an unattributed call denied while another hook may still continue the child', async () => {
    // The headless delivery spawns the child.
    beginTurn(true)
    await hook('SubagentStart')(
      { hook_event_name: 'SubagentStart', agent_id: NATIVE_CHILD, agent_type: 'general-purpose' } as never,
      undefined,
      { signal: new AbortController().signal }
    )
    settleTurn()

    // A desktop follow-up starts and its interactive background server retains the responder.
    beginTurn(false)
    const entry = (runtime() as unknown as { entries: Map<string, any> }).entries.get(SESSION_ID)
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
    ;(runtime() as any).handleRuntimeEvent(entry, { type: 'background-work-state', active: true })
    aiStreamManager.getInteractionWindow.mockReturnValue('window-1')
    windowManager.getWindow.mockReturnValue({})

    // The child now stops — but another hook may keep it running on this same connection.
    await hook('SubagentStop')(
      { hook_event_name: 'SubagentStop', agent_id: NATIVE_CHILD, agent_type: 'general-purpose' } as never,
      undefined,
      { signal: new AbortController().signal }
    )

    expect(runtime().getSessionToolsAuthorization(SESSION_ID)).toMatchObject({
      currentTurn: 'headless',
      userResponse: 'unavailable'
    })
    expect(runtime().getMcpInteractionHost(SESSION_ID)).toBeUndefined()

    // With the connection's own work gone, nothing can still be carrying the continued child, so the
    // stop becomes authoritative and the follow-up's own calls resolve interactively again.
    ;(runtime() as any).handleRuntimeEvent(entry, { type: 'background-work-state', active: false })
    await hook('SubagentStop')(
      { hook_event_name: 'SubagentStop', agent_id: NATIVE_CHILD, agent_type: 'general-purpose' } as never,
      undefined,
      { signal: new AbortController().signal }
    )
    expect(runtime().getSessionToolsAuthorization(SESSION_ID)).toMatchObject({ currentTurn: 'interactive' })
    expect(runtime().getMcpInteractionHost(SESSION_ID)).toMatchObject({ windowId: 'window-1' })
  })
})
