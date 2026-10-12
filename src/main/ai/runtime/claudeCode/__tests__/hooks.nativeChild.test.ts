import type { HookCallback, HookJSONOutput } from '@anthropic-ai/claude-agent-sdk'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { toCherryBuiltinRuntimeName } from '@main/ai/toolApproval/builtinToolPolicy'
import { CONFIG_TOOL_NAME } from '@shared/ai/builtinTools'

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
const { state, aiStreamManager, windowManager, cacheService, warmQueryManager, analyticsService } = vi.hoisted(() => ({
  state: { getToolPolicySnapshot: vi.fn(), getBashNoProgressRun: vi.fn(), getSteerHolder: vi.fn() },
  aiStreamManager: {
    startRuntimeTurn: vi.fn(),
    getInteractionWindow: vi.fn(),
    abort: vi.fn(),
    suspendUnadmittedRuntimeTurn: vi.fn().mockResolvedValue(undefined),
    pauseRuntimeTurn: vi.fn(),
    broadcastTopicError: vi.fn(),
    resolveToolApproval: vi.fn(),
    terminateHeldTopicStream: vi.fn(),
    finalizeHeldTopicStream: vi.fn(async () => undefined)
  },
  windowManager: { getWindow: vi.fn(() => undefined) },
  cacheService: { setShared: vi.fn(), getShared: vi.fn(), deleteShared: vi.fn() },
  warmQueryManager: { closeAll: vi.fn().mockResolvedValue(undefined), closeAgentSessionWarm: vi.fn() },
  analyticsService: { trackTokenUsage: vi.fn() }
}))

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
const MODEL_ID = 'provider-1/model-1'
const CONFIG_TOOL = toCherryBuiltinRuntimeName(CONFIG_TOOL_NAME)
const NATIVE_CHILD = 'child-native-1'

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
    message: { id: 'msg-1', data: { parts: [{ type: 'text', text: 'go' }] } },
    assistantMessageId: 'assistant-1',
    reasoningEffort: 'medium',
    serviceTier: { kind: 'none' },
    knowledgeBaseIds: [],
    fastMode: false,
    ...(headless ? { headless: true } : {})
  })
}

function settleTurn(): void {
  runtime().markTurnTerminal(SESSION_ID, 'success')
}

function hook(kind: 'PreToolUse' | 'SubagentStart'): HookCallback {
  const table = buildClaudeCodeHooks({
    sessionId: SESSION_ID,
    cwd: '/tmp',
    agentDataPath: '/tmp',
    builtinRole: undefined,
    mountedServers: new Set(['cherry-tools']),
    pluginDirectories: new Map(),
    supportsImages: false,
    agentsMdLoader: { createPreToolUseHook: () => async () => ({}) } as never
  })
  const [matcher] = table?.[kind] ?? []
  const [found] = matcher?.hooks ?? []
  if (!found) throw new Error(`no ${kind} hooks registered`)
  return found
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

  it('leaves an interactively spawned child interactive under a later headless turn', async () => {
    beginTurn(false)
    await hook('SubagentStart')(
      { hook_event_name: 'SubagentStart', agent_id: NATIVE_CHILD, agent_type: 'general-purpose' } as never,
      undefined,
      { signal: new AbortController().signal }
    )
    settleTurn()

    beginTurn(true)
    expect(decisionOf(await fireGuard({ agent_id: NATIVE_CHILD })).permissionDecision).toBe('deny')
  })

  it('fails closed for a child whose spawn was never announced', async () => {
    beginTurn(false)
    expect(decisionOf(await fireGuard({ agent_id: 'unannounced-child' })).permissionDecision).toBe('deny')
  })
})
