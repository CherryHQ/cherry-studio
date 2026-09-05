import type { HookCallback, HookJSONOutput } from '@anthropic-ai/claude-agent-sdk'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AgentRuntimeUserInput } from '../../types'

const { holder } = vi.hoisted(() => ({
  holder: {
    pending: [] as AgentRuntimeUserInput[],
    onInjected: undefined as undefined | ((inputs: AgentRuntimeUserInput[]) => void)
  }
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    ClaudeCodeSessionStateService: { getSteerHolder: () => holder },
    AgentSessionRuntimeService: { recordToolExecutionTiming: vi.fn(), getInteractionState: vi.fn() }
  } as never)
})

import { buildClaudeCodeHooks } from '../hooks'

const SESSION_ID = 'session-steer-test'

function makeSteer(text: string): AgentRuntimeUserInput {
  return {
    message: { data: { parts: [{ type: 'text', text }] } }
  } as unknown as AgentRuntimeUserInput
}

function makeHooks() {
  const table = buildClaudeCodeHooks({
    sessionId: SESSION_ID,
    cwd: '/tmp',
    agentDataPath: '/tmp',
    builtinRole: undefined,
    mountedServers: new Set(),
    pluginDirectories: new Map(),
    supportsImages: false,
    agentsMdLoader: { createPreToolUseHook: () => async () => ({}) } as never
  })
  const pick = (event: 'PreToolUse' | 'PostToolBatch'): HookCallback => {
    const matchers = table?.[event]
    if (!matchers?.length) throw new Error(`no hooks registered for ${event}`)
    const found = matchers[0].hooks[matchers[0].hooks.length - 1]
    return found
  }
  return { table, pick }
}

async function runHook(hook: HookCallback, eventName: string): Promise<HookJSONOutput> {
  return hook({ hook_event_name: eventName } as never, undefined, { signal: new AbortController().signal })
}

beforeEach(() => {
  holder.pending = []
  holder.onInjected = undefined
})

describe('steer injection hooks', () => {
  it('registers the steer hook on both PreToolUse and PostToolBatch', () => {
    const { table } = makeHooks()
    expect(table?.PreToolUse?.[0].hooks.length).toBeGreaterThan(0)
    expect(table?.PostToolBatch?.[0].hooks.length).toBeGreaterThan(0)
  })

  it('PostToolBatch injects a pending steer as additionalContext and drains the queue', async () => {
    holder.pending = [makeSteer('change direction')]
    const onInjected = vi.fn()
    holder.onInjected = onInjected

    const out = await runHook(makeHooks().pick('PostToolBatch'), 'PostToolBatch')

    expect((out as { continue?: boolean }).continue).toBe(true)
    const specific = (out as { hookSpecificOutput: { hookEventName: string; additionalContext?: string } })
      .hookSpecificOutput
    expect(specific.hookEventName).toBe('PostToolBatch')
    expect(specific.additionalContext).toContain('change direction')
    expect(holder.pending).toHaveLength(0)
    expect(onInjected).toHaveBeenCalledTimes(1)
  })

  it('PreToolUse still injects a pending steer (regression)', async () => {
    holder.pending = [makeSteer('via pre-tool-use')]

    const out = await runHook(makeHooks().pick('PreToolUse'), 'PreToolUse')

    const specific = (out as { hookSpecificOutput: { hookEventName: string; additionalContext?: string } })
      .hookSpecificOutput
    expect(specific.hookEventName).toBe('PreToolUse')
    expect(specific.additionalContext).toContain('via pre-tool-use')
    expect(holder.pending).toHaveLength(0)
  })

  it('injects once: the queue is drained at the first boundary that fires', async () => {
    holder.pending = [makeSteer('only once')]
    const { pick } = makeHooks()

    const first = await runHook(pick('PostToolBatch'), 'PostToolBatch')
    const second = await runHook(pick('PreToolUse'), 'PreToolUse')

    expect(first).toHaveProperty('hookSpecificOutput')
    expect(second).toEqual({})
  })

  it('restores the queue when the drained steers carry no text', async () => {
    const empty = { message: { data: { parts: [{ type: 'file' }] } } } as unknown as AgentRuntimeUserInput
    holder.pending = [empty]

    const out = await runHook(makeHooks().pick('PostToolBatch'), 'PostToolBatch')

    expect(out).toEqual({})
    expect(holder.pending).toEqual([empty])
  })

  it('ignores hook events it is not bound to', async () => {
    holder.pending = [makeSteer('still waiting')]

    const out = await runHook(makeHooks().pick('PostToolBatch'), 'PreToolUse')

    expect(out).toEqual({})
    expect(holder.pending).toHaveLength(1)
  })
})
