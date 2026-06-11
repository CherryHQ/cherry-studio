import type { ToolSet } from 'ai'
import { describe, expect, it, vi } from 'vitest'

import type { AgentLoopHooks, ToolExecutionEndEvent, ToolExecutionStartEvent } from '../index'
import { wrapToolsWithExecutionHooks } from '../internal'

/** Minimal tool-execute options the wrapper reads (`toolCallId`, `messages`). */
const EXECUTE_OPTIONS = { toolCallId: 'call-1', messages: [] } as unknown as Parameters<
  NonNullable<ToolSet[string]['execute']>
>[1]

/** Builds a ToolSet with a single tool whose `execute` is `execute`. */
function makeTools(execute: ToolSet[string]['execute']): ToolSet {
  return { myTool: { execute } as ToolSet[string] }
}

describe('wrapToolsWithExecutionHooks', () => {
  it('returns the tools unchanged when no tool hooks are set', () => {
    const tools = makeTools(vi.fn())
    expect(wrapToolsWithExecutionHooks(tools, {})).toBe(tools)
  })

  it('returns undefined unchanged', () => {
    expect(wrapToolsWithExecutionHooks(undefined, { onToolExecutionStart: vi.fn() })).toBeUndefined()
  })

  it('passes a tool through unchanged when it has no execute function', () => {
    const tools: ToolSet = { noExec: {} as ToolSet[string] }
    const wrapped = wrapToolsWithExecutionHooks(tools, { onToolExecutionStart: vi.fn() })!
    expect(wrapped.noExec).toBe(tools.noExec)
  })

  it('fires start before execute and end after with the tool result', async () => {
    const order: string[] = []
    const onToolExecutionStart = vi.fn<(e: ToolExecutionStartEvent) => void>(() => void order.push('start'))
    const onToolExecutionEnd = vi.fn<(e: ToolExecutionEndEvent) => void>(() => void order.push('end'))
    const execute = vi.fn(async () => {
      order.push('execute')
      return 'result'
    })

    const hooks: AgentLoopHooks = { onToolExecutionStart, onToolExecutionEnd }
    const wrapped = wrapToolsWithExecutionHooks(makeTools(execute), hooks)!

    const output = await wrapped.myTool.execute!({ q: 1 }, EXECUTE_OPTIONS)

    expect(output).toBe('result')
    expect(order).toEqual(['start', 'execute', 'end'])
    expect(onToolExecutionStart).toHaveBeenCalledWith(
      expect.objectContaining({ callId: 'call-1', toolName: 'myTool', input: { q: 1 } })
    )
    const endEvent = onToolExecutionEnd.mock.calls[0][0]
    expect(endEvent.toolOutput).toEqual({ type: 'tool-result', output: 'result' })
    expect(typeof endEvent.durationMs).toBe('number')
  })

  it('fires end with a tool-error and rethrows when execute throws', async () => {
    const boom = new Error('tool boom')
    const onToolExecutionEnd = vi.fn()
    const execute = vi.fn(async () => {
      throw boom
    })

    const hooks: AgentLoopHooks = { onToolExecutionEnd }
    const wrapped = wrapToolsWithExecutionHooks(makeTools(execute), hooks)!

    await expect(wrapped.myTool.execute!({}, EXECUTE_OPTIONS)).rejects.toBe(boom)
    expect(onToolExecutionEnd).toHaveBeenCalledTimes(1)
    expect(onToolExecutionEnd.mock.calls[0][0].toolOutput).toEqual({ type: 'tool-error', error: boom })
  })

  it('measures durationMs around execute only', async () => {
    const onToolExecutionEnd = vi.fn()
    const execute = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5))
      return 'ok'
    })

    const hooks: AgentLoopHooks = { onToolExecutionEnd }
    const wrapped = wrapToolsWithExecutionHooks(makeTools(execute), hooks)!

    await wrapped.myTool.execute!({}, EXECUTE_OPTIONS)
    expect(onToolExecutionEnd.mock.calls[0][0].durationMs).toBeGreaterThanOrEqual(0)
  })
})
