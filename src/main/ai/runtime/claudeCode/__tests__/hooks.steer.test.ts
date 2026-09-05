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

function hooksFor(event: 'PreToolUse' | 'PostToolBatch'): HookCallback[] {
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
  const matchers = table?.[event]
  if (!matchers?.length) throw new Error(`no hooks registered for ${event}`)
  return matchers.flatMap((matcher) => matcher.hooks)
}

/**
 * Runs every hook the table registers for `event` — no test may depend on the steer hook's position
 * in that list. The other hooks are inert for a bare event payload, so the merged output is the
 * steer hook's own.
 */
async function fireEvent(
  event: 'PreToolUse' | 'PostToolBatch',
  payload: Record<string, unknown> = {}
): Promise<HookJSONOutput> {
  const outputs: HookJSONOutput[] = []
  for (const hook of hooksFor(event)) {
    const out = await hook({ hook_event_name: event, ...payload } as never, undefined, {
      signal: new AbortController().signal
    })
    if (Object.keys(out).length > 0) outputs.push(out)
  }
  if (outputs.length > 1) throw new Error(`${outputs.length} hooks answered ${event}`)
  return outputs[0] ?? {}
}

beforeEach(() => {
  holder.pending = []
  holder.onInjected = undefined
})

describe('steer injection hooks', () => {
  it('PostToolBatch injects a pending steer as additionalContext and drains the queue', async () => {
    holder.pending = [makeSteer('change direction')]
    const onInjected = vi.fn()
    holder.onInjected = onInjected

    const out = await fireEvent('PostToolBatch')

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

    const out = await fireEvent('PreToolUse')

    const specific = (out as { hookSpecificOutput: { hookEventName: string; additionalContext?: string } })
      .hookSpecificOutput
    expect(specific.hookEventName).toBe('PreToolUse')
    expect(specific.additionalContext).toContain('via pre-tool-use')
    expect(holder.pending).toHaveLength(0)
  })

  it('injects once: the queue is drained at the first boundary that fires', async () => {
    holder.pending = [makeSteer('only once')]

    const first = await fireEvent('PostToolBatch')
    const second = await fireEvent('PreToolUse')

    expect(first).toHaveProperty('hookSpecificOutput')
    expect(second).toEqual({})
  })

  it('restores the queue when the drained steers carry no text', async () => {
    const empty = { message: { data: { parts: [{ type: 'file' }] } } } as unknown as AgentRuntimeUserInput
    holder.pending = [empty]

    const out = await fireEvent('PostToolBatch')

    expect(out).toEqual({})
    expect(holder.pending).toEqual([empty])
  })

  it.each(['PostToolBatch', 'PreToolUse'] as const)(
    'leaves the steer queued when %s fires inside a subagent',
    async (event) => {
      holder.pending = [makeSteer('for the top-level turn')]
      const onInjected = vi.fn()
      holder.onInjected = onInjected

      const out = await fireEvent(event, { agent_id: 'agent_worker_1' })

      expect(out).toEqual({})
      expect(holder.pending).toHaveLength(1)
      expect(onInjected).not.toHaveBeenCalled()
    }
  )
})
