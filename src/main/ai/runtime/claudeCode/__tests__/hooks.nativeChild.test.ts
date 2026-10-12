import type { HookCallback, HookJSONOutput } from '@anthropic-ai/claude-agent-sdk'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { toCherryBuiltinRuntimeName } from '@main/ai/toolApproval/builtinToolPolicy'
import { CONFIG_TOOL_NAME } from '@shared/ai/builtinTools'

/**
 * A native Claude child spawned by a headless turn keeps running after that turn settles, and a
 * desktop follow-up can then start on the SAME root Session id. The SDK reports a subagent only by
 * `agent_id` (SubagentStart, and every PreToolUse the child fires), so the guard must resolve the
 * child's OWN originating authority — resolving by session id alone credits it with the desktop
 * follow-up's interactive turn and lets an auto-approved tool like `remove_channel` through.
 */
const { runtime } = vi.hoisted(() => ({
  runtime: {
    getInteractionState: vi.fn(),
    getToolGuardInteractionState: vi.fn(),
    recordToolExecutionTiming: vi.fn()
  }
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    ClaudeCodeSessionStateService: {
      getToolPolicySnapshot: () => undefined,
      peekToolApprovalEmitter: () => undefined,
      getBashNoProgressRun: () => undefined,
      getSteerHolder: () => ({ pending: [] })
    },
    AgentSessionRuntimeService: runtime
  } as never)
})

vi.mock('../skillDependencies', () => ({
  SKILL_TOOL_NAME: 'Skill',
  checkSkillRuntimeDependencies: vi.fn(async () => ({}))
}))

vi.mock('@main/ai/toolApproval/userDataSqliteGuard', () => ({
  USER_DATA_SQLITE_GUARD_REASON: 'Access to SQLite files inside Cherry Studio user data is blocked.',
  evaluateUserDataSqliteGuard: vi.fn(async () => undefined)
}))

import { buildClaudeCodeHooks } from '../hooks'

const SESSION_ID = 'session-native-child'
const CONFIG_TOOL = toCherryBuiltinRuntimeName(CONFIG_TOOL_NAME)
const NATIVE_CHILD = 'agent-native-1'

const INTERACTIVE = { currentTurn: 'interactive', userResponse: 'stream' } as const
const HEADLESS = { currentTurn: 'headless', userResponse: 'unavailable' } as const

function guardHook(): HookCallback {
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
  const [matcher] = table?.PreToolUse ?? []
  const [hook] = matcher?.hooks ?? []
  if (!hook) throw new Error('no PreToolUse hooks registered')
  return hook
}

async function fireConfigCall(payload: Record<string, unknown>): Promise<HookJSONOutput> {
  return guardHook()(
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

beforeEach(() => {
  // The desktop follow-up is live and interactive, and the session-level resolution cannot tell
  // the still-running headless child apart from it — only the agent_id-aware resolution can.
  runtime.getInteractionState.mockReturnValue(INTERACTIVE)
  runtime.getToolGuardInteractionState.mockImplementation((_sessionId: string, agentId?: string) =>
    agentId === NATIVE_CHILD ? HEADLESS : INTERACTIVE
  )
})

describe('native Claude child authority on the PreToolUse plane', () => {
  it('denies a headless-spawned child the mutating config tool while the desktop turn is interactive', async () => {
    const out = await fireConfigCall({ agent_id: NATIVE_CHILD })
    const decision = (
      out as { hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string } }
    ).hookSpecificOutput

    expect(decision?.permissionDecision).toBe('deny')
    expect(decision?.permissionDecisionReason).toContain('cannot mutate agent configuration')
  })

  it('leaves the desktop turn itself interactive', async () => {
    await expect(fireConfigCall({})).resolves.not.toHaveProperty('hookSpecificOutput.permissionDecision')
  })
})
