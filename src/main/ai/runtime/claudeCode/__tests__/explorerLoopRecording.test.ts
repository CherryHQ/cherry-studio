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

  const firePostToolUseFailure = (toolName: string, input: Record<string, unknown>, agentId?: string) =>
    Promise.all(
      postToolUseHooks.map((h) =>
        h(
          {
            hook_event_name: 'PostToolUseFailure',
            tool_name: toolName,
            tool_input: input,
            error: 'Error: file not found',
            tool_use_id: 'tu-test-fail',
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

  it('records explorer outcomes on PostToolUseFailure', async () => {
    await firePostToolUseFailure('Read', { file_path: 'src/missing.ts' })
    const status = svc.getExplorerLoopStatus(SESSION, 'Read', { file_path: 'src/missing.ts' })
    expect(status?.identicalRun).toBe(2)
    expect(status?.consecutiveReads).toBe(2)
  })

  it('resets explorer loop state when save_attachment completes with output_path', async () => {
    for (let i = 0; i < 10; i++) {
      await firePostToolUse('Read', { file_path: 'src/asset.png', offset: i * 50, limit: 50 })
    }
    const capStatus = svc.getExplorerLoopStatus(SESSION, 'Read', { file_path: 'src/asset.png', offset: 500, limit: 50 })
    expect(capStatus?.sameFileCapReached).toBe(true)

    // Fire save_attachment with output_path
    await firePostToolUse('mcp__assistant-files__save_attachment', {
      filename: 'remote.png',
      output_path: 'src/asset.png'
    })
    const unlockedStatus = svc.getExplorerLoopStatus(SESSION, 'Read', {
      file_path: 'src/asset.png',
      offset: 500,
      limit: 50
    })
    expect(unlockedStatus?.sameFileCapReached).toBeFalsy()
  })

  it('resets explorer loop state with per-file scope when Edit completes', async () => {
    for (let i = 0; i < 10; i++) {
      await firePostToolUse('Read', { file_path: 'src/index.ts', offset: i * 50, limit: 50 })
    }
    // Reading 11th time on index.ts hits same-file cap
    const capStatus = svc.getExplorerLoopStatus(SESSION, 'Read', { file_path: 'src/index.ts', offset: 500, limit: 50 })
    expect(capStatus?.sameFileCapReached).toBe(true)

    // Edit an unrelated file: index.ts cap MUST remain locked
    await firePostToolUse('Edit', { file_path: 'src/unrelated.ts' })
    const stillLockedStatus = svc.getExplorerLoopStatus(SESSION, 'Read', {
      file_path: 'src/index.ts',
      offset: 500,
      limit: 50
    })
    expect(stillLockedStatus?.sameFileCapReached).toBe(true)

    // Edit index.ts: index.ts readCount is cleared so reading can proceed
    await firePostToolUse('Edit', { file_path: 'src/index.ts' })
    const unlockedStatus = svc.getExplorerLoopStatus(SESSION, 'Read', {
      file_path: 'src/index.ts',
      offset: 500,
      limit: 50
    })
    expect(unlockedStatus?.sameFileCapReached).toBeFalsy()
  })

  it('resets all explorer state when a new user turn starts via UserPromptSubmit', async () => {
    for (let i = 0; i < 10; i++) {
      await firePostToolUse('Read', { file_path: 'src/index.ts', offset: i * 50, limit: 50 })
    }
    expect(
      svc.getExplorerLoopStatus(SESSION, 'Read', { file_path: 'src/index.ts', offset: 500, limit: 50 })
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

    const newTurnStatus = svc.getExplorerLoopStatus(SESSION, 'Read', {
      file_path: 'src/index.ts',
      offset: 0,
      limit: 50
    })
    expect(newTurnStatus?.sameFileCapReached).toBeFalsy()
  })

  it('delivers ladder warnings for identical calls (3, 4)', async () => {
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

    const res3 = (await preToolUse()) as { hookSpecificOutput?: { additionalContext?: string } }
    expect(res3.hookSpecificOutput?.additionalContext).toContain(
      'Identical call limit (user constraint): 3/5. Edit/Write or report to user to reset.'
    )

    await firePostToolUse('Read', { file_path: 'src/app.ts' })
    const res4 = (await preToolUse()) as { hookSpecificOutput?: { additionalContext?: string } }
    expect(res4.hookSpecificOutput?.additionalContext).toContain(
      'CRITICAL: identical call limit (user constraint) 4/5 (1 attempt left).'
    )
  })

  it('delivers ladder warnings for file reads (7, 8, 9)', async () => {
    const preToolUse = () =>
      toolGuardHook(
        {
          hook_event_name: 'PreToolUse',
          tool_name: 'Read',
          tool_input: { file_path: 'src/file.ts' },
          tool_use_id: 'tu-file'
        } as never,
        undefined,
        {} as never
      )

    for (let i = 1; i <= 6; i++) {
      await firePostToolUse('Read', { file_path: 'src/file.ts', offset: i * 10 })
    }

    const res7 = (await preToolUse()) as { hookSpecificOutput?: { additionalContext?: string } }
    expect(res7.hookSpecificOutput?.additionalContext).toContain(
      "File read limit (user constraint): 7/10 on 'src/file.ts'. Tip: request larger line limits."
    )

    await firePostToolUse('Read', { file_path: 'src/file.ts', offset: 70 })
    const res8 = (await preToolUse()) as { hookSpecificOutput?: { additionalContext?: string } }
    expect(res8.hookSpecificOutput?.additionalContext).toContain(
      "File read limit (user constraint): 8/10 on 'src/file.ts' (2 left)."
    )

    await firePostToolUse('Read', { file_path: 'src/file.ts', offset: 80 })
    await firePostToolUse('Read', { file_path: 'src/file.ts', offset: 90 })
    const res10 = (await preToolUse()) as { hookSpecificOutput?: { additionalContext?: string } }
    expect(res10.hookSpecificOutput?.additionalContext).toContain(
      "CRITICAL: file read limit (user constraint): 10/10 on 'src/file.ts' (last allowed read before lock)."
    )
  })

  it('delivers ladder warnings for exploration budget and injects steer on cap', async () => {
    const preToolUse = (file: string) =>
      toolGuardHook(
        {
          hook_event_name: 'PreToolUse',
          tool_name: 'Read',
          tool_input: { file_path: file },
          tool_use_id: 'tu-cap'
        } as never,
        undefined,
        {} as never
      )

    for (let i = 1; i <= 9; i++) {
      await firePostToolUse('Read', { file_path: `file_${i}.ts` })
    }

    const res10 = (await preToolUse('file_10.ts')) as { hookSpecificOutput?: { additionalContext?: string } }
    expect(res10.hookSpecificOutput?.additionalContext).toContain(
      'Exploration limit (user constraint): 10/30 reads used.'
    )
    expect(res10.hookSpecificOutput?.additionalContext).toContain('Reaching 30 will FORCIBLY ABORT the session.')
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
