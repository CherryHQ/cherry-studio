import type { HookCallback, HookJSONOutput } from '@anthropic-ai/claude-agent-sdk'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { withCherryMeta } from '@shared/data/types/uiParts'

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
    supportsImages: false
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
    const out = await hook({ hook_event_name: event, tool_calls: [], ...payload } as never, undefined, {
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

  it.each(['PostToolBatch', 'PreToolUse'] as const)(
    'expands quoted steers with shared numbering at %s',
    async (event) => {
      const question = event === 'PreToolUse' ? '' : 'Compare these points'
      const steers = [makeSteer(question), makeSteer('')]
      steers.forEach((steer, index) => {
        steer.message.data.parts = [
          withCherryMeta(
            { type: 'text', text: index === 0 ? question : '' },
            {
              quotes: [
                {
                  id: `quote-${index}`,
                  sourceMessageId: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d001',
                  text: `Quoted point ${index}`
                }
              ]
            }
          )
        ]
      })
      holder.pending = steers
      const out = await fireEvent(event)
      const context = (out as { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput
        .additionalContext
      expect(context).toContain('# User request')
      if (question) expect(context).toContain(question)
      expect(context).toContain('[Reference N](#cherry-quote-N)')
      expect(context).toContain(
        JSON.stringify([
          { index: 1, text: 'Quoted point 0' },
          { index: 2, text: 'Quoted point 1' }
        ])
      )
      expect(holder.pending).toEqual([])
    }
  )

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
