import type { HookCallback, HookJSONOutput } from '@anthropic-ai/claude-agent-sdk'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const sessionState = vi.hoisted(() => ({
  getToolPolicySnapshot: vi.fn(),
  getBashNoProgressRun: vi.fn(),
  recordBashRewriteOrigin: vi.fn(),
  takeBashRewriteOrigin: vi.fn(),
  getSteerHolder: vi.fn(() => ({ pending: [] })),
  disposeBashScope: vi.fn()
}))

const interactionState = vi.hoisted(() => ({
  currentTurn: 'interactive',
  userResponse: 'stream'
}))

const applicationMock = vi.hoisted(() => ({ get: vi.fn() }))
const loggerMock = vi.hoisted(() => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }))

vi.mock('@application', () => ({ application: applicationMock }))
vi.mock('@logger', () => ({ loggerService: { withContext: () => loggerMock } }))
vi.mock('@main/ai/steerReminder', () => ({ wrapSteerReminder: (text: string) => text }))
vi.mock('@main/utils/rtk', () => ({ rtkRewrite: vi.fn(async () => null) }))
vi.mock('@main/ai/toolApproval/userDataSqliteGuard', () => ({
  USER_DATA_SQLITE_GUARD_REASON: 'SQLite access is blocked.',
  evaluateUserDataSqliteGuard: vi.fn(async () => undefined)
}))
vi.mock('../skillDependencies', () => ({
  SKILL_TOOL_NAME: 'Skill',
  checkSkillRuntimeDependencies: vi.fn(async () => ({}))
}))

import { buildClaudeCodeHooks } from '../hooks'

const SESSION_ID = 'subagent-image-session'
const IMAGE_PATH = '/workspace/project/assets/diagram.png'
const TEXT_PATH = '/workspace/project/src/Game.cs'

type PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions'
type AliasMap = { opus: boolean; sonnet: boolean; haiku: boolean }

function makeHooks(
  supportsImages: boolean,
  subagentImageSupport: AliasMap,
  permissionMode: PermissionMode = 'default'
) {
  sessionState.getToolPolicySnapshot.mockReturnValue({
    getPermissionMode: vi.fn(() => permissionMode),
    isDisabled: vi.fn(() => false)
  })
  return buildClaudeCodeHooks({
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
}

function hooksFor(table: ReturnType<typeof buildClaudeCodeHooks>, event: string): HookCallback[] {
  const matchers = (table as unknown as Record<string, Array<{ hooks: HookCallback[] }>>)?.[event]
  if (!matchers) return []
  return matchers.flatMap((matcher) => matcher.hooks)
}

/** Fires every hook registered for the event and folds PreToolUse permission decisions (deny wins). */
async function firePreToolUse(
  table: ReturnType<typeof buildClaudeCodeHooks>,
  payload: Record<string, unknown>
): Promise<HookJSONOutput> {
  let denied: HookJSONOutput | undefined
  for (const hook of hooksFor(table, 'PreToolUse')) {
    const out = await hook({ hook_event_name: 'PreToolUse', ...payload } as never, 'test-tool-use', {
      signal: new AbortController().signal
    })
    if (
      (out as { hookSpecificOutput?: { permissionDecision?: string } })?.hookSpecificOutput?.permissionDecision ===
      'deny'
    ) {
      denied = out
    }
  }
  return denied ?? {}
}

async function fireEvent(
  table: ReturnType<typeof buildClaudeCodeHooks>,
  event: string,
  payload: Record<string, unknown>
) {
  for (const hook of hooksFor(table, event)) {
    await hook({ hook_event_name: event, ...payload } as never, undefined, {
      signal: new AbortController().signal
    })
  }
}

async function launchSubagent(
  table: ReturnType<typeof buildClaudeCodeHooks>,
  toolUseId: string,
  input: Record<string, unknown>
) {
  await firePreToolUse(table, { tool_name: 'Task', tool_input: input, tool_use_id: toolUseId })
}

async function startSubagent(table: ReturnType<typeof buildClaudeCodeHooks>, agentId: string, agentType: string) {
  await fireEvent(table, 'SubagentStart', { agent_id: agentId, agent_type: agentType })
}

async function stopSubagent(table: ReturnType<typeof buildClaudeCodeHooks>, agentId: string) {
  await fireEvent(table, 'SubagentStop', { agent_id: agentId, stop_hook_active: false })
}

async function readImage(table: ReturnType<typeof buildClaudeCodeHooks>, agentId?: string) {
  return firePreToolUse(table, {
    tool_name: 'Read',
    tool_input: { file_path: IMAGE_PATH },
    tool_use_id: `read-${agentId ?? 'parent'}`,
    ...(agentId ? { agent_id: agentId } : {})
  })
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

describe('Claude Code subagent image capability', () => {
  it.each(['default', 'acceptEdits', 'bypassPermissions'] as PermissionMode[])(
    'allows an image read for a vision-capable haiku subagent under a text-only parent (%s)',
    async (permissionMode) => {
      const table = makeHooks(false, { opus: false, sonnet: false, haiku: true }, permissionMode)

      await launchSubagent(table, 'task-use-haiku', { model: 'haiku', subagent_type: 'vision-worker' })
      await startSubagent(table, 'agent-vision', 'vision-worker')

      await expect(readImage(table, 'agent-vision')).resolves.toEqual({})
    }
  )

  it('keeps text-only subagents and the parent denied while a vision sibling is allowed', async () => {
    const table = makeHooks(false, { opus: true, sonnet: false, haiku: false })

    await launchSubagent(table, 'task-use-opus', { model: 'opus', subagent_type: 'vision-worker' })
    await startSubagent(table, 'agent-vision', 'vision-worker')
    await launchSubagent(table, 'task-use-sonnet', { model: 'sonnet', subagent_type: 'text-worker' })
    await startSubagent(table, 'agent-text', 'text-worker')

    await expect(readImage(table, 'agent-vision')).resolves.toEqual({})
    const deniedReason = expect.objectContaining({
      permissionDecision: 'deny',
      permissionDecisionReason: expect.stringContaining('does not support image input')
    })
    await expect(readImage(table, 'agent-text')).resolves.toMatchObject({
      hookSpecificOutput: deniedReason
    })
    await expect(readImage(table)).resolves.toMatchObject({
      hookSpecificOutput: expect.objectContaining({ permissionDecision: 'deny' })
    })
  })

  it('lets an explicit text-only alias narrow a vision-capable parent session', async () => {
    const table = makeHooks(true, { opus: true, sonnet: false, haiku: true })

    await launchSubagent(table, 'task-use-sonnet', { model: 'SONNET', subagent_type: 'text-worker' })
    await startSubagent(table, 'agent-text', 'text-worker')

    await expect(readImage(table, 'agent-text')).resolves.toMatchObject({
      hookSpecificOutput: expect.objectContaining({ permissionDecision: 'deny' })
    })
    await expect(readImage(table)).resolves.toEqual({})
  })

  it('inherits the parent capability for unknown aliases, inherit, and missing model', async () => {
    const table = makeHooks(false, { opus: true, sonnet: true, haiku: true })

    for (const [toolUseId, input, agentId] of [
      ['task-use-custom', { model: 'custom-worker', subagent_type: 'custom' }, 'agent-custom'],
      ['task-use-inherit', { model: 'inherit', subagent_type: 'heir' }, 'agent-heir'],
      ['task-use-empty', { subagent_type: 'bare' }, 'agent-bare']
    ] as const) {
      await launchSubagent(table, toolUseId, input)
      await startSubagent(table, agentId, input.subagent_type)
      await expect(readImage(table, agentId)).resolves.toMatchObject({
        hookSpecificOutput: expect.objectContaining({ permissionDecision: 'deny' })
      })
    }
  })

  it('inherits the parent model for fork subagents even when a vision alias is requested', async () => {
    const table = makeHooks(false, { opus: true, sonnet: true, haiku: true })

    await launchSubagent(table, 'task-use-fork', { model: 'opus', subagent_type: 'fork' })
    await startSubagent(table, 'agent-fork', 'fork')

    await expect(readImage(table, 'agent-fork')).resolves.toMatchObject({
      hookSpecificOutput: expect.objectContaining({ permissionDecision: 'deny' })
    })
  })

  it('inherits the parent capability for a SubagentStart with no launch tag', async () => {
    const table = makeHooks(false, { opus: true, sonnet: true, haiku: true })

    await startSubagent(table, 'agent-orphan', 'vision-worker')

    await expect(readImage(table, 'agent-orphan')).resolves.toMatchObject({
      hookSpecificOutput: expect.objectContaining({ permissionDecision: 'deny' })
    })
  })

  it('clears the subagent binding at SubagentStop', async () => {
    const table = makeHooks(true, { opus: true, sonnet: false, haiku: true })

    await launchSubagent(table, 'task-use-sonnet', { model: 'sonnet', subagent_type: 'text-worker' })
    await startSubagent(table, 'agent-text', 'text-worker')
    await expect(readImage(table, 'agent-text')).resolves.toMatchObject({
      hookSpecificOutput: expect.objectContaining({ permissionDecision: 'deny' })
    })

    await stopSubagent(table, 'agent-text')
    expect(sessionState.disposeBashScope).toHaveBeenCalledWith(SESSION_ID, 'agent-text')
    await expect(readImage(table, 'agent-text')).resolves.toEqual({})
  })

  it('does not let a denied launch poison a later same-type launch', async () => {
    const table = makeHooks(false, { opus: false, sonnet: false, haiku: true })

    // First launch is denied before spawn: no SubagentStart, batch-end sweep cleans it up.
    await launchSubagent(table, 'task-denied', { model: 'sonnet', subagent_type: 'worker' })
    await fireEvent(table, 'PostToolBatch', {
      tool_calls: [{ tool_name: 'Task', tool_input: { model: 'sonnet' }, tool_use_id: 'task-denied' }]
    })

    await launchSubagent(table, 'task-vision', { model: 'haiku', subagent_type: 'worker' })
    await startSubagent(table, 'agent-vision', 'worker')

    await expect(readImage(table, 'agent-vision')).resolves.toEqual({})
  })

  it('retracts the launch tag on PostToolUseFailure and PermissionDenied', async () => {
    const table = makeHooks(false, { opus: false, sonnet: false, haiku: true })

    await launchSubagent(table, 'task-failed', { model: 'sonnet', subagent_type: 'worker' })
    await fireEvent(table, 'PostToolUseFailure', {
      tool_name: 'Task',
      tool_input: { model: 'sonnet' },
      tool_use_id: 'task-failed',
      error: 'launch failed'
    })
    await launchSubagent(table, 'task-denied', { model: 'sonnet', subagent_type: 'worker' })
    await fireEvent(table, 'PermissionDenied', {
      tool_name: 'Task',
      tool_input: { model: 'sonnet' },
      tool_use_id: 'task-denied',
      reason: 'user denied'
    })

    await launchSubagent(table, 'task-vision', { model: 'haiku', subagent_type: 'worker' })
    await startSubagent(table, 'agent-vision', 'worker')

    await expect(readImage(table, 'agent-vision')).resolves.toEqual({})
  })

  it('keeps a backgrounded launch tag across PostToolUse and PostToolBatch until SubagentStart', async () => {
    const table = makeHooks(false, { opus: false, sonnet: false, haiku: true })
    const launchInput = { model: 'haiku', subagent_type: 'vision-worker', run_in_background: true }

    await launchSubagent(table, 'task-bg', launchInput)
    // A backgrounded call resolves at acknowledgement time, before its SubagentStart arrives.
    await fireEvent(table, 'PostToolUse', {
      tool_name: 'Task',
      tool_input: launchInput,
      tool_use_id: 'task-bg'
    })
    await fireEvent(table, 'PostToolBatch', {
      tool_calls: [{ tool_name: 'Task', tool_input: launchInput, tool_use_id: 'task-bg' }]
    })
    await startSubagent(table, 'agent-bg', 'vision-worker')

    await expect(readImage(table, 'agent-bg')).resolves.toEqual({})
    await expect(readImage(table)).resolves.toMatchObject({
      hookSpecificOutput: expect.objectContaining({ permissionDecision: 'deny' })
    })
  })

  it('treats remote-isolation launches as backgrounded', async () => {
    const table = makeHooks(false, { opus: false, sonnet: false, haiku: true })
    const launchInput = { model: 'haiku', subagent_type: 'vision-worker', isolation: 'remote' }

    await launchSubagent(table, 'task-remote', launchInput)
    await fireEvent(table, 'PostToolUse', {
      tool_name: 'Task',
      tool_input: launchInput,
      tool_use_id: 'task-remote'
    })
    await fireEvent(table, 'PostToolBatch', {
      tool_calls: [{ tool_name: 'Task', tool_input: launchInput, tool_use_id: 'task-remote' }]
    })
    await startSubagent(table, 'agent-remote', 'vision-worker')

    await expect(readImage(table, 'agent-remote')).resolves.toEqual({})
  })

  it('still reaps foreground leftovers at batch end', async () => {
    const table = makeHooks(false, { opus: false, sonnet: false, haiku: true })

    await launchSubagent(table, 'task-stale', { model: 'sonnet', subagent_type: 'worker' })
    await fireEvent(table, 'PostToolBatch', {
      tool_calls: [{ tool_name: 'Task', tool_input: { model: 'sonnet' }, tool_use_id: 'task-stale' }]
    })

    await launchSubagent(table, 'task-vision', { model: 'haiku', subagent_type: 'worker' })
    await startSubagent(table, 'agent-vision', 'worker')

    await expect(readImage(table, 'agent-vision')).resolves.toEqual({})
  })

  it('bounds pending launches and keeps cross-type binding under overflow', async () => {
    const table = makeHooks(false, { opus: false, sonnet: false, haiku: true })

    for (let i = 0; i < 55; i++) {
      await launchSubagent(table, `task-abandoned-${i}`, { model: 'sonnet', subagent_type: 'stale-worker' })
    }
    expect(loggerMock.debug).toHaveBeenCalledWith(
      'Dropping oldest pending subagent launch',
      expect.objectContaining({ toolUseId: 'task-abandoned-0' })
    )

    await launchSubagent(table, 'task-vision', { model: 'haiku', subagent_type: 'vision-worker' })
    await startSubagent(table, 'agent-vision', 'vision-worker')

    await expect(readImage(table, 'agent-vision')).resolves.toEqual({})
  })

  it('allows non-image reads for subagents regardless of image capability', async () => {
    const table = makeHooks(false, { opus: false, sonnet: false, haiku: false })

    await launchSubagent(table, 'task-use-text', { model: 'sonnet', subagent_type: 'text-worker' })
    await startSubagent(table, 'agent-text', 'text-worker')

    await expect(
      firePreToolUse(table, {
        tool_name: 'Read',
        tool_input: { file_path: TEXT_PATH },
        tool_use_id: 'read-text',
        agent_id: 'agent-text'
      })
    ).resolves.toEqual({})
  })
})
