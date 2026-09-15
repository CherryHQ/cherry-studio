import type { HookCallback } from '@anthropic-ai/claude-agent-sdk'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { applicationMock, loggerMock, sessionState, interactionState } = vi.hoisted(() => ({
  applicationMock: { get: vi.fn() },
  loggerMock: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  sessionState: {
    getToolPolicySnapshot: vi.fn(),
    getBashNoProgressRun: vi.fn(),
    recordBashRewriteOrigin: vi.fn(),
    takeBashRewriteOrigin: vi.fn(),
    getSteerHolder: vi.fn(() => ({ pending: [] })),
    disposeBashScope: vi.fn()
  },
  interactionState: { currentTurn: 'interactive', userResponse: 'stream' }
}))

vi.mock('@application', () => ({ application: applicationMock }))
vi.mock('@logger', () => ({ loggerService: { withContext: () => loggerMock } }))
vi.mock('@main/ai/steerReminder', () => ({ wrapSteerReminder: (text: string) => text }))
vi.mock('@main/utils/rtk', () => ({ rtkRewrite: vi.fn(async () => null) }))
vi.mock('../skillDependencies', () => ({ SKILL_TOOL_NAME: 'Skill', checkSkillRuntimeDependencies: vi.fn() }))
vi.mock('@main/ai/toolApproval/userDataSqliteGuard', () => ({
  USER_DATA_SQLITE_GUARD_REASON: 'SQLite access is blocked.',
  evaluateUserDataSqliteGuard: vi.fn(async () => undefined)
}))

import { buildClaudeCodeHooks } from '../hooks'

const SESSION_ID = 'subagent-image-session'
const AGENT_TYPES = {
  vision: 'vision-worker',
  text: 'text-worker'
} as const

type PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions'

function makeHooks(
  supportsImages: boolean,
  subagentImageSupport: Readonly<Record<'haiku' | 'sonnet' | 'opus', boolean | undefined>>
): {
  preToolUse: HookCallback
  subagentStart: HookCallback
  subagentStop: HookCallback
} {
  const table = buildClaudeCodeHooks({
    sessionId: SESSION_ID,
    cwd: '/workspace/project',
    agentDataPath: '/workspace/data',
    builtinRole: undefined,
    mountedServers: new Set(),
    pluginDirectories: new Map(),
    supportsImages,
    subagentImageSupport,
    agentsMdLoader: { createPreToolUseHook: () => async () => ({}) } as never
  })
  if (!table?.PreToolUse?.[0]?.hooks[0] || !table.SubagentStart?.[0]?.hooks[0] || !table.SubagentStop?.[0]?.hooks[0]) {
    throw new Error('expected Claude Code subagent hooks')
  }
  return {
    preToolUse: table.PreToolUse[0].hooks[0],
    subagentStart: table.SubagentStart[0].hooks[0],
    subagentStop: table.SubagentStop[0].hooks[0]
  }
}

async function fireRead(preToolUse: HookCallback, filePath: string, agentId?: string) {
  return preToolUse(
    {
      hook_event_name: 'PreToolUse',
      tool_name: 'Read',
      tool_input: { file_path: filePath },
      ...(agentId ? { agent_id: agentId } : {})
    } as never,
    'read-tool-use',
    { signal: new AbortController().signal }
  )
}

async function launchSubagent(
  hooks: ReturnType<typeof makeHooks>,
  model: string,
  agentType: string,
  agentId: string
): Promise<void> {
  await hooks.preToolUse(
    {
      hook_event_name: 'PreToolUse',
      tool_name: 'Task',
      tool_input: { model, subagent_type: agentType }
    } as never,
    'task-tool-use',
    { signal: new AbortController().signal }
  )
  await hooks.subagentStart(
    { hook_event_name: 'SubagentStart', agent_id: agentId, agent_type: agentType } as never,
    undefined,
    { signal: new AbortController().signal }
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  sessionState.getToolPolicySnapshot.mockReturnValue({
    getPermissionMode: vi.fn(() => 'default'),
    isDisabled: vi.fn(() => false)
  })
  sessionState.getBashNoProgressRun.mockReturnValue(undefined)
  applicationMock.get.mockImplementation((name: string) => {
    if (name === 'ClaudeCodeSessionStateService') return sessionState
    if (name === 'AgentSessionRuntimeService') return { getInteractionState: () => interactionState }
    throw new Error(`unexpected service: ${name}`)
  })
})

describe('Claude Code subagent image capability hooks', () => {
  it.each(['default', 'acceptEdits', 'bypassPermissions'] as PermissionMode[])(
    'allows an image read for a vision-capable opus subagent under %s',
    async (permissionMode) => {
      sessionState.getToolPolicySnapshot.mockReturnValue({
        getPermissionMode: vi.fn(() => permissionMode),
        isDisabled: vi.fn(() => false)
      })
      const hooks = makeHooks(false, { opus: true, sonnet: false, haiku: false })

      await launchSubagent(hooks, 'opus', AGENT_TYPES.vision, 'agent-vision')

      await expect(fireRead(hooks.preToolUse, '/workspace/project/diagram.png', 'agent-vision')).resolves.toEqual({})
    }
  )

  it('keeps text-only subagents denied while a sibling vision subagent is allowed', async () => {
    const hooks = makeHooks(false, { opus: true, sonnet: false, haiku: false })

    await launchSubagent(hooks, 'opus', AGENT_TYPES.vision, 'agent-vision')
    await launchSubagent(hooks, 'sonnet', AGENT_TYPES.text, 'agent-text')

    await expect(fireRead(hooks.preToolUse, '/workspace/project/diagram.png', 'agent-vision')).resolves.toEqual({})
    await expect(fireRead(hooks.preToolUse, '/workspace/project/diagram.png', 'agent-text')).resolves.toMatchObject({
      hookSpecificOutput: expect.objectContaining({
        permissionDecision: 'deny',
        permissionDecisionReason: expect.stringContaining('does not support image input')
      })
    })
    await expect(fireRead(hooks.preToolUse, '/workspace/project/diagram.png')).resolves.toMatchObject({
      hookSpecificOutput: expect.objectContaining({ permissionDecision: 'deny' })
    })
  })

  it('lets an explicit text-only alias override a vision-capable parent session', async () => {
    const hooks = makeHooks(true, { opus: true, sonnet: false, haiku: true })

    await launchSubagent(hooks, 'SONNET', AGENT_TYPES.text, 'agent-text')

    await expect(fireRead(hooks.preToolUse, '/workspace/project/diagram.png', 'agent-text')).resolves.toMatchObject({
      hookSpecificOutput: expect.objectContaining({ permissionDecision: 'deny' })
    })
  })

  it('preserves an untyped launch while binding a typed sibling', async () => {
    const hooks = makeHooks(true, { opus: true, sonnet: false, haiku: true })

    await hooks.preToolUse(
      {
        hook_event_name: 'PreToolUse',
        tool_name: 'Task',
        tool_input: { model: 'opus', subagent_type: AGENT_TYPES.vision }
      } as never,
      'typed-launch',
      { signal: new AbortController().signal }
    )
    await hooks.preToolUse(
      { hook_event_name: 'PreToolUse', tool_name: 'Task', tool_input: { model: 'sonnet' } } as never,
      'untyped-launch',
      { signal: new AbortController().signal }
    )
    await hooks.subagentStart(
      { hook_event_name: 'SubagentStart', agent_id: 'agent-vision', agent_type: AGENT_TYPES.vision } as never,
      undefined,
      { signal: new AbortController().signal }
    )
    await hooks.subagentStart(
      { hook_event_name: 'SubagentStart', agent_id: 'agent-text', agent_type: AGENT_TYPES.text } as never,
      undefined,
      { signal: new AbortController().signal }
    )

    await expect(fireRead(hooks.preToolUse, '/workspace/project/diagram.png', 'agent-vision')).resolves.toEqual({})
    await expect(fireRead(hooks.preToolUse, '/workspace/project/diagram.png', 'agent-text')).resolves.toMatchObject({
      hookSpecificOutput: expect.objectContaining({ permissionDecision: 'deny' })
    })
  })

  it('inherits the parent capability for unknown aliases and clears it at SubagentStop', async () => {
    const hooks = makeHooks(false, { opus: true, sonnet: true, haiku: true })

    await launchSubagent(hooks, 'custom-worker', AGENT_TYPES.text, 'agent-custom')
    await expect(fireRead(hooks.preToolUse, '/workspace/project/diagram.png', 'agent-custom')).resolves.toMatchObject({
      hookSpecificOutput: expect.objectContaining({ permissionDecision: 'deny' })
    })

    await hooks.subagentStop({ hook_event_name: 'SubagentStop', agent_id: 'agent-custom' } as never, undefined, {
      signal: new AbortController().signal
    })
    await expect(fireRead(hooks.preToolUse, '/workspace/project/diagram.png', 'agent-custom')).resolves.toMatchObject({
      hookSpecificOutput: expect.objectContaining({ permissionDecision: 'deny' })
    })
    expect(sessionState.disposeBashScope).toHaveBeenCalledWith(SESSION_ID, 'agent-custom')
  })
})
