import type { HookCallback } from '@anthropic-ai/claude-agent-sdk'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { loggerMock, applicationMock } = vi.hoisted(() => {
  const loggerMock = { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }
  const applicationMock = { get: vi.fn() }
  return { loggerMock, applicationMock }
})

vi.mock('@application', () => ({ application: applicationMock }))
vi.mock('@logger', () => ({ loggerService: { withContext: () => loggerMock } }))
vi.mock('@data/services/AgentService', () => ({ agentService: {} }))
vi.mock('@data/services/McpServerService', () => ({ mcpServerService: {} }))
vi.mock('@main/ai/toolApproval/ToolApprovalRegistry', () => ({ toolApprovalRegistry: { abort: vi.fn() } }))
vi.mock('@main/ai/tools/adapters/claudeCode/agentTools', () => ({ createClaudeAgentToolPolicySnapshot: vi.fn() }))
vi.mock('@main/core/lifecycle', async () => {
  const actual = (await vi.importActual('@main/core/lifecycle')) as Record<string, unknown>
  class StubBase {}
  return { ...actual, BaseService: StubBase }
})
vi.mock('@main/ai/steerReminder', () => ({ wrapSteerReminder: (text: string) => text }))
vi.mock('@main/ai/toolApproval/toolGuards', () => ({ evaluateToolGuards: vi.fn(async () => undefined) }))
vi.mock('@main/utils/rtk', () => ({ rtkRewrite: vi.fn(async () => null) }))
vi.mock('../guardRules', () => ({ CLAUDE_TOOL_GUARD_RULES: [] }))
vi.mock('../skillDependencies', () => ({ SKILL_TOOL_NAME: 'Skill', checkSkillRuntimeDependencies: vi.fn() }))

import { ClaudeCodeSessionStateService } from '../ClaudeCodeSessionStateService'
import { EXPLORER_CAP_THRESHOLD, EXPLORER_IDENTICAL_THRESHOLD } from '../explorerLoop'
import { buildClaudeCodeHooks } from '../hooks'

const SESSION = 'session-explorer-1'

describe('ClaudeCodeSessionStateService explorer outcome recording and hooks', () => {
  let svc: ClaudeCodeSessionStateService
  let toolGuardHook: HookCallback
  let postToolUseHooks: HookCallback[]
  let subagentStopHook: HookCallback
  let hooks: ReturnType<typeof buildClaudeCodeHooks>

  beforeEach(() => {
    svc = new ClaudeCodeSessionStateService()
    applicationMock.get.mockImplementation((id: string) => {
      if (id === 'ClaudeCodeSessionStateService') return svc
      if (id === 'AgentSessionRuntimeService')
        return { getInteractionState: () => ({ currentTurn: 'interactive', userResponse: 'stream' }) }
      return {}
    })

    hooks = buildClaudeCodeHooks({
      sessionId: SESSION,
      cwd: '/test/cwd',
      agentDataPath: '/test/agent',
      builtinRole: undefined,
      mountedServers: new Set(),
      pluginDirectories: new Map(),
      supportsImages: true,
      agentsMdLoader: { createPreToolUseHook: () => vi.fn() } as never
    })

    const preToolHooks = hooks?.PreToolUse
    const postHooks = hooks?.PostToolUse
    const stopHooks = hooks?.SubagentStop

    if (!preToolHooks || !preToolHooks[0] || !postHooks || !postHooks[0] || !stopHooks || !stopHooks[0]) {
      throw new Error('Hooks not properly initialized')
    }

    toolGuardHook = preToolHooks[0].hooks[0]
    postToolUseHooks = postHooks[0].hooks
    subagentStopHook = stopHooks[0].hooks[0]
  })

  const firePostToolUse = (toolName: string, input: Record<string, unknown>, agentId?: string) =>
    Promise.all(
      postToolUseHooks.map((h) =>
        h(
          {
            hook_event_name: 'PostToolUse',
            tool_name: toolName,
            tool_input: input,
            tool_response: {},
            tool_use_id: 'tu-test',
            ...(agentId ? { agent_id: agentId } : {})
          } as never,
          undefined,
          {} as never
        )
      )
    )

  it('records explorer outcomes on PostToolUse and returns expected status', async () => {
    await firePostToolUse('Read', { file_path: 'src/index.ts', offset: 1, limit: 100 })
    const status = svc.getExplorerLoopStatus(SESSION, 'Read', { file_path: 'src/index.ts', offset: 1, limit: 100 })
    expect(status?.identicalRun).toBe(2)
    expect(status?.consecutiveReads).toBe(2)
  })

  it('tracks covered intervals and flags duplicate chunks on repeat', async () => {
    await firePostToolUse('Read', { file_path: 'src/app.ts', offset: 1, limit: 500 })
    const subsetStatus = svc.getExplorerLoopStatus(SESSION, 'Read', { file_path: 'src/app.ts', offset: 50, limit: 100 })
    expect(subsetStatus?.isDuplicateChunk).toBe(true)
  })

  it('tracks traversal backward jump cycles', async () => {
    await firePostToolUse('Read', { file_path: 'src/cycle.ts', offset: 1, limit: 200 })
    await firePostToolUse('Read', { file_path: 'src/cycle.ts', offset: 500, limit: 200 })
    const backStatus = svc.getExplorerLoopStatus(SESSION, 'Read', { file_path: 'src/cycle.ts', offset: 1, limit: 100 })
    expect(backStatus?.isCycle).toBe(true)
  })

  it('resets explorer loop state with per-file scope and interval preservation when Edit completes', async () => {
    for (let i = 0; i < 4; i++) {
      await firePostToolUse('Read', { file_path: 'src/index.ts', offset: i * 50, limit: 50 })
    }
    // Reading 5th time on index.ts hits same-file cap
    const capStatus = svc.getExplorerLoopStatus(SESSION, 'Read', { file_path: 'src/index.ts', offset: 200, limit: 50 })
    expect(capStatus?.sameFileCapReached).toBe(true)

    // Edit an unrelated file: index.ts cap MUST remain locked
    await firePostToolUse('Edit', { file_path: 'src/unrelated.ts' })
    const stillLockedStatus = svc.getExplorerLoopStatus(SESSION, 'Read', {
      file_path: 'src/index.ts',
      offset: 200,
      limit: 50
    })
    expect(stillLockedStatus?.sameFileCapReached).toBe(true)

    // Edit index.ts: index.ts readCount is cleared so new lines (501-550) can be read
    await firePostToolUse('Edit', { file_path: 'src/index.ts' })
    const unlockedStatus = svc.getExplorerLoopStatus(SESSION, 'Read', {
      file_path: 'src/index.ts',
      offset: 501,
      limit: 50
    })
    expect(unlockedStatus?.sameFileCapReached).toBeFalsy()

    // BUT previously covered lines (e.g. lines 0-49) must still be rejected as duplicate chunks (Interval Preservation)
    const duplicateStatus = svc.getExplorerLoopStatus(SESSION, 'Read', {
      file_path: 'src/index.ts',
      offset: 10,
      limit: 30
    })
    expect(duplicateStatus?.isDuplicateChunk || duplicateStatus?.isCycle).toBeTruthy()
  })

  it('resets all explorer state when a new user turn starts via UserPromptSubmit', async () => {
    for (let i = 0; i < 4; i++) {
      await firePostToolUse('Read', { file_path: 'src/index.ts', offset: i * 50, limit: 50 })
    }
    expect(
      svc.getExplorerLoopStatus(SESSION, 'Read', { file_path: 'src/index.ts', offset: 200, limit: 50 })
        ?.sameFileCapReached
    ).toBe(true)

    // Simulate UserPromptSubmit hook firing for a fresh user prompt
    const userPromptHook = hooks?.UserPromptSubmit?.[0]?.hooks[0]
    expect(userPromptHook).toBeDefined()
    if (userPromptHook) {
      await userPromptHook(
        {
          hook_event_name: 'UserPromptSubmit'
        } as never,
        undefined,
        {} as never
      )
    }

    // State is completely reset for new user turn: same-file cap and previous chunks are cleared
    const newTurnStatus = svc.getExplorerLoopStatus(SESSION, 'Read', {
      file_path: 'src/index.ts',
      offset: 0,
      limit: 50
    })
    expect(newTurnStatus?.sameFileCapReached).toBeFalsy()
    expect(newTurnStatus?.isDuplicateChunk).toBeFalsy()
  })

  it('delivers soft warning at identical threshold 3', async () => {
    const preToolUse = () =>
      toolGuardHook(
        {
          hook_event_name: 'PreToolUse',
          tool_name: 'Read',
          tool_input: { file_path: 'src/app.ts' },
          tool_use_id: 'tu-1'
        } as never,
        undefined,
        {} as never
      )

    await firePostToolUse('Read', { file_path: 'src/app.ts' })
    await firePostToolUse('Read', { file_path: 'src/app.ts' })

    const result = (await preToolUse()) as { hookSpecificOutput?: { additionalContext?: string } }
    expect(result.hookSpecificOutput?.additionalContext).toContain(
      `identical parameters ${EXPLORER_IDENTICAL_THRESHOLD} times`
    )
  })

  it('delivers soft warning at consecutive read cap 10', async () => {
    for (let i = 1; i <= 9; i++) {
      await firePostToolUse('Read', { file_path: `file_${i}.ts` })
    }

    const preToolUse = () =>
      toolGuardHook(
        {
          hook_event_name: 'PreToolUse',
          tool_name: 'Read',
          tool_input: { file_path: 'file_10.ts' },
          tool_use_id: 'tu-cap'
        } as never,
        undefined,
        {} as never
      )

    const result = (await preToolUse()) as { hookSpecificOutput?: { additionalContext?: string } }
    expect(result.hookSpecificOutput?.additionalContext).toContain(`consecutive file reads/searches`)
    expect(result.hookSpecificOutput?.additionalContext).toContain(String(EXPLORER_CAP_THRESHOLD))
  })

  it('scopes subagents independently and cleans up on SubagentStop', async () => {
    await firePostToolUse('Read', { file_path: 'sub.ts' }, 'subagent-1')
    expect(svc.getExplorerLoopStatus(SESSION, 'Read', { file_path: 'sub.ts' }, 'subagent-1')).toBeDefined()
    expect(svc.getExplorerLoopStatus(SESSION, 'Read', { file_path: 'sub.ts' })).toBeUndefined()

    await subagentStopHook(
      {
        hook_event_name: 'SubagentStop',
        agent_id: 'subagent-1'
      } as never,
      undefined,
      {} as never
    )
    expect(svc.getExplorerLoopStatus(SESSION, 'Read', { file_path: 'sub.ts' }, 'subagent-1')).toBeUndefined()
  })
})
