import type { AgentPermissionMode } from '@shared/data/api/schemas/agents'
import type { Tool } from 'ai'
import { jsonSchema } from 'ai'
import { describe, expect, it, vi } from 'vitest'

import type { AgentToolApprovalClass, AgentToolPolicy } from './toolPolicy'
import { applyToolPolicy, requiresApproval } from './toolPolicy'

const CALL_OPTIONS = { toolCallId: 'call-1', messages: [] }

function makeBaseTool(execute = vi.fn(async () => 'ok')): { tool: Tool; execute: ReturnType<typeof vi.fn> } {
  return {
    tool: {
      description: 'test tool',
      inputSchema: jsonSchema<Record<string, unknown>>({ type: 'object' }),
      execute
    },
    execute
  }
}

function makePolicy(
  mode: AgentPermissionMode = 'default',
  disabled: Iterable<string> = []
): {
  policy: AgentToolPolicy
  setMode: (mode: AgentPermissionMode) => void
  disabledTools: Set<string>
} {
  let currentMode = mode
  const disabledTools = new Set(disabled)
  return {
    policy: {
      getPermissionMode: () => currentMode,
      isDisabled: (name) => disabledTools.has(name)
    },
    setMode: (next) => {
      currentMode = next
    },
    disabledTools
  }
}

async function evaluateNeedsApproval(tool: Tool, input: unknown = {}): Promise<boolean> {
  const gate = tool.needsApproval
  if (typeof gate === 'function') return await gate(input as never, CALL_OPTIONS)
  return gate ?? false
}

describe('requiresApproval permission matrix', () => {
  it.each<[AgentToolApprovalClass, AgentPermissionMode, boolean]>([
    ['auto', 'default', false],
    ['auto', 'acceptEdits', false],
    ['auto', 'bypassPermissions', false],
    ['edit', 'default', true],
    ['edit', 'acceptEdits', false],
    ['edit', 'bypassPermissions', false],
    ['prompt', 'default', true],
    ['prompt', 'acceptEdits', true],
    ['prompt', 'bypassPermissions', false]
  ])('class %s under %s → prompts: %s', (approvalClass, mode, expected) => {
    expect(requiresApproval(mode, approvalClass)).toBe(expected)
  })
})

describe('applyToolPolicy', () => {
  it('reads the live permission mode at fire-time', async () => {
    const { tool } = makeBaseTool()
    const { policy, setMode } = makePolicy('default')
    const wrapped = applyToolPolicy('write', tool, policy, { approvalClass: 'edit' })

    expect(await evaluateNeedsApproval(wrapped)).toBe(true)
    setMode('acceptEdits')
    expect(await evaluateNeedsApproval(wrapped)).toBe(false)
    setMode('bypassPermissions')
    expect(await evaluateNeedsApproval(wrapped)).toBe(false)
  })

  it('denies a disabled tool at execution time without prompting, in every mode', async () => {
    const { tool, execute } = makeBaseTool()
    const { policy, disabledTools, setMode } = makePolicy('bypassPermissions', ['bash'])
    const wrapped = applyToolPolicy('bash', tool, policy, { approvalClass: 'prompt' })

    for (const mode of ['default', 'acceptEdits', 'bypassPermissions'] as const) {
      setMode(mode)
      expect(await evaluateNeedsApproval(wrapped)).toBe(false)
      await expect(wrapped.execute!({} as never, CALL_OPTIONS)).rejects.toThrow('disabled for this agent')
    }
    expect(execute).not.toHaveBeenCalled()

    // Live tightening works both ways: re-enabling takes effect on the next call.
    disabledTools.delete('bash')
    setMode('bypassPermissions')
    await expect(wrapped.execute!({} as never, CALL_OPTIONS)).resolves.toBe('ok')
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('hard denial blocks without a prompt and before the base tool runs', async () => {
    const { tool, execute } = makeBaseTool()
    const { policy } = makePolicy('bypassPermissions')
    const wrapped = applyToolPolicy('bash', tool, policy, {
      approvalClass: 'prompt',
      denyReason: (input) => ((input as { command?: string }).command === 'evil' ? 'blocked: evil' : null)
    })

    expect(await evaluateNeedsApproval(wrapped, { command: 'evil' })).toBe(false)
    await expect(wrapped.execute!({ command: 'evil' } as never, CALL_OPTIONS)).rejects.toThrow('blocked: evil')
    expect(execute).not.toHaveBeenCalled()

    await expect(wrapped.execute!({ command: 'fine' } as never, CALL_OPTIONS)).resolves.toBe('ok')
  })

  it('passes input and call options through to the base execute', async () => {
    const execute = vi.fn(async (input: unknown) => input)
    const { tool } = makeBaseTool(execute)
    const { policy } = makePolicy('default')
    const wrapped = applyToolPolicy('read', tool, policy, { approvalClass: 'auto' })

    await expect(wrapped.execute!({ path: 'a.txt' } as never, CALL_OPTIONS)).resolves.toEqual({ path: 'a.txt' })
    expect(execute).toHaveBeenCalledWith({ path: 'a.txt' }, CALL_OPTIONS)
  })

  it('rejects a base tool without execute at build time', () => {
    const { policy } = makePolicy()
    const tool: Tool = { description: 'no exec', inputSchema: jsonSchema<Record<string, unknown>>({ type: 'object' }) }
    expect(() => applyToolPolicy('broken', tool, policy, { approvalClass: 'auto' })).toThrow('has no execute')
  })
})
