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
const runtimeService = vi.hoisted(() => ({ getInteractionState: vi.fn(() => ({ currentTurn: 'interactive' })) }))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    ClaudeCodeSessionStateService: sessionState,
    AgentSessionRuntimeService: runtimeService
  } as never)
})

import { buildClaudeCodeHooks } from '../hooks'

const SESSION_ID = 'subagent-image-session'
const IMAGE_PATH = '/workspace/project/assets/diagram.png'

function makeHooks(supportsImages: boolean, subagentImageSupport: Record<'opus' | 'sonnet' | 'haiku', boolean>) {
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
  const matchers = (table as unknown as Record<string, Array<{ hooks: HookCallback[] }>>)[event]
  return matchers?.flatMap((matcher) => matcher.hooks) ?? []
}

async function fire(
  table: ReturnType<typeof buildClaudeCodeHooks>,
  event: string,
  payload: Record<string, unknown>
): Promise<HookJSONOutput> {
  let denied: HookJSONOutput | undefined
  for (const hook of hooksFor(table, event)) {
    const output = await hook(
      { hook_event_name: event, ...payload } as never,
      payload.tool_use_id as string | undefined,
      {
        signal: new AbortController().signal
      }
    )
    if (
      (output as { hookSpecificOutput?: { permissionDecision?: string } })?.hookSpecificOutput?.permissionDecision ===
      'deny'
    ) {
      denied = output
    }
  }
  return denied ?? {}
}

async function launch(table: ReturnType<typeof buildClaudeCodeHooks>, model: string, type: string) {
  await fire(table, 'PreToolUse', {
    tool_name: 'Task',
    tool_input: { model, subagent_type: type },
    tool_use_id: `launch-${model}-${type}`
  })
}

async function start(table: ReturnType<typeof buildClaudeCodeHooks>, agentId: string, type: string) {
  await fire(table, 'SubagentStart', { agent_id: agentId, agent_type: type })
}

async function readImage(table: ReturnType<typeof buildClaudeCodeHooks>, agentId?: string) {
  return fire(table, 'PreToolUse', {
    tool_name: 'Read',
    tool_input: { file_path: IMAGE_PATH },
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
  runtimeService.getInteractionState.mockReturnValue({ currentTurn: 'interactive' })
})

describe('Claude Code subagent image capability', () => {
  it.each(['default', 'acceptEdits', 'bypassPermissions'])('allows a vision child under %s', async (permissionMode) => {
    sessionState.getToolPolicySnapshot.mockReturnValue({
      getPermissionMode: vi.fn(() => permissionMode),
      isDisabled: vi.fn(() => false)
    })
    const table = makeHooks(false, { opus: false, sonnet: false, haiku: true })
    await launch(table, 'haiku', 'vision-worker')
    await start(table, 'agent-vision', 'vision-worker')
    await expect(readImage(table, 'agent-vision')).resolves.toEqual({})
  })

  it('keeps a text child and the parent denied while a vision sibling is allowed', async () => {
    const table = makeHooks(false, { opus: true, sonnet: false, haiku: true })
    await launch(table, 'haiku', 'vision-worker')
    await start(table, 'agent-vision', 'vision-worker')
    await launch(table, 'sonnet', 'text-worker')
    await start(table, 'agent-text', 'text-worker')

    await expect(readImage(table, 'agent-vision')).resolves.toEqual({})
    await expect(readImage(table, 'agent-text')).resolves.toMatchObject({
      hookSpecificOutput: expect.objectContaining({ permissionDecision: 'deny' })
    })
    await expect(readImage(table)).resolves.toMatchObject({
      hookSpecificOutput: expect.objectContaining({ permissionDecision: 'deny' })
    })
  })

  it('keeps a successful launch pending through PostToolUse until SubagentStart', async () => {
    const table = makeHooks(false, { opus: false, sonnet: false, haiku: true })
    await launch(table, 'haiku', 'vision-worker')
    await fire(table, 'PostToolUse', { tool_name: 'Task', tool_use_id: 'launch-haiku-vision-worker' })
    await start(table, 'agent-vision', 'vision-worker')
    await expect(readImage(table, 'agent-vision')).resolves.toEqual({})
  })

  it('uses the parent capability for fork and denies unknown aliases', async () => {
    const table = makeHooks(false, { opus: true, sonnet: true, haiku: true })
    await launch(table, 'opus', 'fork')
    await start(table, 'agent-fork', 'fork')
    await expect(readImage(table, 'agent-fork')).resolves.toMatchObject({
      hookSpecificOutput: expect.objectContaining({ permissionDecision: 'deny' })
    })

    await launch(table, 'custom', 'unknown-worker')
    await start(table, 'agent-unknown', 'unknown-worker')
    await expect(readImage(table, 'agent-unknown')).resolves.toMatchObject({
      hookSpecificOutput: expect.objectContaining({ permissionDecision: 'deny' })
    })
  })

  it('does not guess when concurrent same-type launches cannot be correlated', async () => {
    const table = makeHooks(true, { opus: true, sonnet: false, haiku: true })
    await launch(table, 'sonnet', 'worker')
    await launch(table, 'haiku', 'worker')
    await start(table, 'agent-ambiguous', 'worker')
    await expect(readImage(table, 'agent-ambiguous')).resolves.toMatchObject({
      hookSpecificOutput: expect.objectContaining({ permissionDecision: 'deny' })
    })
  })

  it('clears pending and active capability state at SessionEnd', async () => {
    const table = makeHooks(true, { opus: true, sonnet: false, haiku: true })
    await launch(table, 'sonnet', 'worker')
    await start(table, 'agent-text', 'worker')
    await fire(table, 'SessionEnd', {})
    await expect(readImage(table, 'agent-text')).resolves.toEqual({})
  })

  it('removes a failed launch before a later same-type child starts', async () => {
    const table = makeHooks(true, { opus: true, sonnet: false, haiku: true })
    await launch(table, 'sonnet', 'worker')
    await fire(table, 'PostToolUseFailure', {
      tool_name: 'Task',
      tool_use_id: 'launch-sonnet-worker'
    })
    await launch(table, 'haiku', 'worker')
    await start(table, 'agent-vision', 'worker')
    await expect(readImage(table, 'agent-vision')).resolves.toEqual({})
  })
})
