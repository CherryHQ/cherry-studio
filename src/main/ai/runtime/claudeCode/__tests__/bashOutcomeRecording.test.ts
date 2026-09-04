/**
 * Wiring coverage for the bash-repeat-no-progress recorder path: the session-state ring on
 * ClaudeCodeSessionStateService (record / run query / eviction / dispose) and bashOutcomeHook
 * (the PostToolUse/PostToolUseFailure half that feeds it). bashNoProgress.test.ts covers the
 * pure detection module; these cases exist because the guard-rule tests stub bashNoProgressRun
 * directly and never exercise this wiring.
 */

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
// hooks.ts module-load deps the outcome hook never touches.
vi.mock('@main/ai/steerReminder', () => ({ wrapSteerReminder: (text: string) => text }))
vi.mock('@main/ai/toolApproval/toolGuards', () => ({ evaluateToolGuards: vi.fn(async () => undefined) }))
vi.mock('@main/utils/rtk', () => ({ rtkRewrite: vi.fn(async () => null) }))
vi.mock('../guardRules', () => ({ CLAUDE_TOOL_GUARD_RULES: [] }))
vi.mock('../skillDependencies', () => ({ SKILL_TOOL_NAME: 'Skill', checkSkillRuntimeDependencies: vi.fn() }))

import { evaluateToolGuards } from '@main/ai/toolApproval/toolGuards'

import { BASH_HISTORY_LIMIT, BASH_NO_PROGRESS_THRESHOLD } from '../bashNoProgress'
import { ClaudeCodeSessionStateService } from '../ClaudeCodeSessionStateService'
import { buildClaudeCodeHooks } from '../hooks'

const SESSION = 'session-1'

const bashOutcomesOf = (svc: ClaudeCodeSessionStateService, sessionId: string) =>
  (svc as unknown as { bashOutcomes: Map<string, unknown[]> }).bashOutcomes.get(sessionId)

describe('ClaudeCodeSessionStateService bash outcome recording', () => {
  let svc: ClaudeCodeSessionStateService

  beforeEach(() => {
    svc = new ClaudeCodeSessionStateService()
  })

  it('records outcomes and reports the trailing no-progress run', () => {
    for (let i = 0; i < BASH_NO_PROGRESS_THRESHOLD; i++) {
      svc.recordBashOutcome(SESSION, 'curl -s http://x', 'same body', false)
    }
    expect(svc.getBashNoProgressRun(SESSION, 'curl -s http://x')).toBe(BASH_NO_PROGRESS_THRESHOLD)
  })

  it('evicts the oldest entry at BASH_HISTORY_LIMIT without corrupting the trailing run', () => {
    for (let i = 0; i < BASH_HISTORY_LIMIT - BASH_NO_PROGRESS_THRESHOLD; i++) {
      svc.recordBashOutcome(SESSION, `filler ${i}`, 'x', false)
    }
    for (let i = 0; i < BASH_NO_PROGRESS_THRESHOLD; i++) {
      svc.recordBashOutcome(SESSION, 'curl x', 'same', false)
    }
    svc.recordBashOutcome(SESSION, 'curl x', 'same', false)

    // The 17th entry drops the oldest filler; the trailing run survives and keeps growing.
    expect(bashOutcomesOf(svc, SESSION)).toHaveLength(BASH_HISTORY_LIMIT)
    expect(svc.getBashNoProgressRun(SESSION, 'curl x')).toBe(BASH_NO_PROGRESS_THRESHOLD + 1)
  })

  it('clears the session bash history on disposeToolPolicySnapshot', () => {
    for (let i = 0; i < BASH_NO_PROGRESS_THRESHOLD; i++) {
      svc.recordBashOutcome(SESSION, 'curl x', 'same', false)
    }
    svc.disposeToolPolicySnapshot(SESSION)

    expect(svc.getBashNoProgressRun(SESSION, 'curl x')).toBeUndefined()
    expect(bashOutcomesOf(svc, SESSION)).toBeUndefined()
  })

  it('ends the trailing run on a recorded run break', () => {
    for (let i = 0; i < BASH_NO_PROGRESS_THRESHOLD; i++) {
      svc.recordBashOutcome(SESSION, 'curl x', 'same', false)
    }
    svc.recordBashRunBreak(SESSION)

    expect(svc.getBashNoProgressRun(SESSION, 'curl x')).toBeUndefined()
  })

  it('run break is a no-op when the session has no Bash history', () => {
    svc.recordBashRunBreak(SESSION)

    expect(bashOutcomesOf(svc, SESSION)).toBeUndefined()
  })

  it('scopes outcome history per agent: a subagent loop never reaches the main thread', () => {
    for (let i = 0; i < BASH_NO_PROGRESS_THRESHOLD; i++) {
      svc.recordBashOutcome(SESSION, 'curl x', 'same', false, 'agent-1')
    }

    expect(svc.getBashNoProgressRun(SESSION, 'curl x', 'agent-1')).toBe(BASH_NO_PROGRESS_THRESHOLD)
    expect(svc.getBashNoProgressRun(SESSION, 'curl x')).toBeUndefined()
  })

  it('a run break in one scope leaves the other scope intact', () => {
    for (let i = 0; i < BASH_NO_PROGRESS_THRESHOLD; i++) {
      svc.recordBashOutcome(SESSION, 'curl x', 'same', false)
      svc.recordBashOutcome(SESSION, 'curl x', 'same', false, 'agent-1')
    }
    svc.recordBashRunBreak(SESSION)

    expect(svc.getBashNoProgressRun(SESSION, 'curl x')).toBeUndefined()
    expect(svc.getBashNoProgressRun(SESSION, 'curl x', 'agent-1')).toBe(BASH_NO_PROGRESS_THRESHOLD)
  })

  it('disposeBashScope drops only the named subagent scope', () => {
    for (let i = 0; i < BASH_NO_PROGRESS_THRESHOLD; i++) {
      svc.recordBashOutcome(SESSION, 'curl x', 'same', false)
      svc.recordBashOutcome(SESSION, 'curl x', 'same', false, 'agent-1')
      svc.recordBashOutcome(SESSION, 'curl x', 'same', false, 'agent-2')
    }

    svc.disposeBashScope(SESSION, 'agent-1')

    expect(svc.getBashNoProgressRun(SESSION, 'curl x')).toBe(BASH_NO_PROGRESS_THRESHOLD)
    expect(svc.getBashNoProgressRun(SESSION, 'curl x', 'agent-1')).toBeUndefined()
    expect(svc.getBashNoProgressRun(SESSION, 'curl x', 'agent-2')).toBe(BASH_NO_PROGRESS_THRESHOLD)
  })

  it('dispose sweeps subagent scopes together with the parent session', () => {
    svc.recordBashOutcome(SESSION, 'curl x', 'same', false)
    svc.recordBashOutcome(SESSION, 'curl x', 'same', false, 'agent-1')

    svc.disposeToolPolicySnapshot(SESSION)

    expect(svc.getBashNoProgressRun(SESSION, 'curl x')).toBeUndefined()
    expect(svc.getBashNoProgressRun(SESSION, 'curl x', 'agent-1')).toBeUndefined()
    expect((svc as unknown as { bashOutcomes: Map<string, unknown[]> }).bashOutcomes.size).toBe(0)
  })
})

describe('bashOutcomeHook', () => {
  const svc = new ClaudeCodeSessionStateService()
  let bashOutcomeHook: HookCallback
  let toolGuardHook: HookCallback
  let subagentStopHook: HookCallback

  beforeEach(() => {
    applicationMock.get.mockImplementation((name: string) => {
      if (name === 'ClaudeCodeSessionStateService') return svc
      if (name === 'AgentSessionRuntimeService') return { getInteractionState: () => undefined }
      throw new Error(`unexpected service: ${name}`)
    })
    vi.mocked(evaluateToolGuards).mockClear()
    svc.disposeToolPolicySnapshot(SESSION)

    const hooks = buildClaudeCodeHooks({
      sessionId: SESSION,
      cwd: '/ws',
      agentDataPath: '/data',
      builtinRole: undefined,
      mountedServers: new Set(),
      pluginDirectories: new Map(),
      supportsImages: false,
      agentsMdLoader: { createPreToolUseHook: () => async () => ({}) } as never
    })
    // PreToolUse: [toolGuardHook, skillDependencyAdvisoryHook, agentsMdHook, rtkRewriteHook, steerHook].
    toolGuardHook = hooks!.PreToolUse![0].hooks[0]
    // PostToolUse: [postToolTimingHook, bashOutcomeHook] — the outcome hook is the second entry.
    bashOutcomeHook = hooks!.PostToolUse![0].hooks[1]
    subagentStopHook = hooks!.SubagentStop![0].hooks[0]
  })

  const fire = (input: Record<string, unknown>) => bashOutcomeHook(input as never, undefined, {} as never)

  const bashSuccess = (response: unknown, agentId?: string) => ({
    hook_event_name: 'PostToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'npx tsc --noEmit' },
    tool_response: response,
    tool_use_id: 'tu-1',
    ...(agentId ? { agent_id: agentId } : {})
  })

  it('records a real PostToolUse payload into the session history', async () => {
    for (let i = 0; i < BASH_NO_PROGRESS_THRESHOLD; i++) {
      await fire(bashSuccess({ stdout: 'error TS2322', interrupted: false }))
    }

    expect(svc.getBashNoProgressRun(SESSION, 'npx tsc --noEmit')).toBe(BASH_NO_PROGRESS_THRESHOLD)
  })

  it('records a PostToolUseFailure as a failed outcome, so an unchanged error also counts', async () => {
    for (let i = 0; i < BASH_NO_PROGRESS_THRESHOLD; i++) {
      await fire({
        hook_event_name: 'PostToolUseFailure',
        tool_name: 'Bash',
        tool_input: { command: 'npx tsc --noEmit' },
        tool_use_id: 'tu-1',
        error: 'exited 2'
      })
    }

    expect(svc.getBashNoProgressRun(SESSION, 'npx tsc --noEmit')).toBe(BASH_NO_PROGRESS_THRESHOLD)
  })

  it('clears an existing run on a PostToolUseFailure carrying is_interrupt — an Esc is a deliberate stop', async () => {
    for (let i = 0; i < BASH_NO_PROGRESS_THRESHOLD; i++) {
      await fire(bashSuccess({ stdout: 'error TS2322' }))
    }
    expect(svc.getBashNoProgressRun(SESSION, 'npx tsc --noEmit')).toBe(BASH_NO_PROGRESS_THRESHOLD)

    await fire({
      hook_event_name: 'PostToolUseFailure',
      tool_name: 'Bash',
      tool_input: { command: 'npx tsc --noEmit' },
      tool_use_id: 'tu-1',
      error: 'interrupted',
      is_interrupt: true
    })

    // Merely skipping the recording would leave the run in place and deny the user's next retry.
    expect(svc.getBashNoProgressRun(SESSION, 'npx tsc --noEmit')).toBeUndefined()
  })

  it('clears an existing run on a PostToolUse whose Bash response reports interrupted', async () => {
    for (let i = 0; i < BASH_NO_PROGRESS_THRESHOLD; i++) {
      await fire(bashSuccess({ stdout: 'error TS2322' }))
    }
    expect(svc.getBashNoProgressRun(SESSION, 'npx tsc --noEmit')).toBe(BASH_NO_PROGRESS_THRESHOLD)

    await fire(bashSuccess({ stdout: 'partial', interrupted: true }))

    expect(svc.getBashNoProgressRun(SESSION, 'npx tsc --noEmit')).toBeUndefined()
  })

  it('an interrupt with no prior history records nothing', async () => {
    await fire({
      hook_event_name: 'PostToolUseFailure',
      tool_name: 'Bash',
      tool_input: { command: 'npx tsc --noEmit' },
      tool_use_id: 'tu-1',
      error: 'interrupted',
      is_interrupt: true
    })

    expect(svc.getBashNoProgressRun(SESSION, 'npx tsc --noEmit')).toBeUndefined()
    expect(bashOutcomesOf(svc, SESSION)).toBeUndefined()
  })

  it('breaks the run when a mutating tool completes between verifier runs', async () => {
    for (let i = 0; i < BASH_NO_PROGRESS_THRESHOLD; i++) {
      await fire(bashSuccess({ stdout: 'error TS2322' }))
    }
    await fire({
      hook_event_name: 'PostToolUse',
      tool_name: 'Edit',
      tool_input: {},
      tool_response: {},
      tool_use_id: 'tu-2'
    })

    expect(svc.getBashNoProgressRun(SESSION, 'npx tsc --noEmit')).toBeUndefined()
  })

  it('does not break the run on a failed mutation or a read-only tool', async () => {
    for (let i = 0; i < BASH_NO_PROGRESS_THRESHOLD; i++) {
      await fire(bashSuccess({ stdout: 'error TS2322' }))
    }
    await fire({
      hook_event_name: 'PostToolUseFailure',
      tool_name: 'Edit',
      tool_input: {},
      tool_use_id: 'tu-2',
      error: 'old_string not found'
    })
    await fire({
      hook_event_name: 'PostToolUse',
      tool_name: 'Read',
      tool_input: {},
      tool_response: {},
      tool_use_id: 'tu-3'
    })

    expect(svc.getBashNoProgressRun(SESSION, 'npx tsc --noEmit')).toBe(BASH_NO_PROGRESS_THRESHOLD)
  })

  it('records subagent outcomes under the subagent scope, never the main thread', async () => {
    for (let i = 0; i < BASH_NO_PROGRESS_THRESHOLD; i++) {
      await fire(bashSuccess({ stdout: 'error TS2322' }, 'agent-1'))
    }

    expect(svc.getBashNoProgressRun(SESSION, 'npx tsc --noEmit', 'agent-1')).toBe(BASH_NO_PROGRESS_THRESHOLD)
    expect(svc.getBashNoProgressRun(SESSION, 'npx tsc --noEmit')).toBeUndefined()
  })

  it('the guard query reads the scope of the calling agent', async () => {
    for (let i = 0; i < BASH_NO_PROGRESS_THRESHOLD; i++) {
      svc.recordBashOutcome(SESSION, 'npx tsc --noEmit', 'same', false, 'agent-1')
    }

    const preToolUse = (agentId?: string) =>
      toolGuardHook(
        {
          hook_event_name: 'PreToolUse',
          tool_name: 'Bash',
          tool_input: { command: 'npx tsc --noEmit' },
          tool_use_id: 'tu-9',
          ...(agentId ? { agent_id: agentId } : {})
        } as never,
        undefined,
        {} as never
      )

    await preToolUse('agent-1')
    await preToolUse()

    const ctxOf = (call: number) =>
      vi.mocked(evaluateToolGuards).mock.calls[call][1] as unknown as {
        bashNoProgressRun?: (command: string) => number | undefined
      }
    expect(ctxOf(0).bashNoProgressRun?.('npx tsc --noEmit')).toBe(BASH_NO_PROGRESS_THRESHOLD)
    expect(ctxOf(1).bashNoProgressRun?.('npx tsc --noEmit')).toBeUndefined()
  })

  it('breaks the run when an assistant-files MCP tool mutates the workspace', async () => {
    for (let i = 0; i < BASH_NO_PROGRESS_THRESHOLD; i++) {
      await fire(bashSuccess({ stdout: 'error TS2322' }))
    }
    await fire({
      hook_event_name: 'PostToolUse',
      tool_name: 'mcp__assistant-files__save_attachment',
      tool_input: {},
      tool_response: {},
      tool_use_id: 'tu-4'
    })

    expect(svc.getBashNoProgressRun(SESSION, 'npx tsc --noEmit')).toBeUndefined()
  })

  it('drops the subagent scope when the subagent stops', async () => {
    for (let i = 0; i < BASH_NO_PROGRESS_THRESHOLD; i++) {
      await fire(bashSuccess({ stdout: 'error TS2322' }, 'agent-1'))
    }
    expect(svc.getBashNoProgressRun(SESSION, 'npx tsc --noEmit', 'agent-1')).toBe(BASH_NO_PROGRESS_THRESHOLD)

    await subagentStopHook(
      {
        hook_event_name: 'SubagentStop',
        agent_id: 'agent-1',
        agent_type: 'general-purpose',
        stop_hook_active: false
      } as never,
      undefined,
      {} as never
    )

    expect(svc.getBashNoProgressRun(SESSION, 'npx tsc --noEmit', 'agent-1')).toBeUndefined()
  })
})
