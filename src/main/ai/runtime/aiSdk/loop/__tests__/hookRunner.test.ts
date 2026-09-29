import { mockMainLoggerService } from '@test-mocks/MainLoggerService'
import type { ToolSet } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { wrapToolsWithExecutionHooks } from '../hookRunner'
import type { AgentLoopHooks, ToolExecutionEndEvent, ToolExecutionStartEvent } from '../types'

/** Minimal tool-execute options the wrapper reads (`toolCallId`, `messages`). */
const EXECUTE_OPTIONS = { toolCallId: 'call-1', messages: [] } as unknown as Parameters<
  NonNullable<ToolSet[string]['execute']>
>[1]

/** Builds a ToolSet with a single tool whose `execute` is `execute`. */
function makeTools(execute: ToolSet[string]['execute']): ToolSet {
  return { myTool: { execute } as ToolSet[string] }
}

describe('wrapToolsWithExecutionHooks', () => {
  beforeEach(() => {
    mockMainLoggerService.warn.mockClear()
  })

  it('logs failed tool execution without hooks and rethrows the original error', async () => {
    const error = new Error('tool failed')
    const tools = makeTools(async () => {
      throw error
    })
    const wrapped = wrapToolsWithExecutionHooks(tools, {})!

    await expect(wrapped.myTool.execute!({ 'private diagnosis': 'private input' }, EXECUTE_OPTIONS)).rejects.toBe(error)
    expect(mockMainLoggerService.warn).toHaveBeenCalledWith(
      'Tool execution failed',
      expect.objectContaining({
        toolName: 'myTool',
        toolCallId: 'call-1',
        inputShape: expect.any(Object),
        err: expect.objectContaining({ errorMessage: 'tool failed' })
      })
    )
    expect(JSON.stringify(mockMainLoggerService.warn.mock.calls)).not.toContain('private')
  })

  it('preserves successful results without hooks and does not log cancellation as a failure', async () => {
    const output = { value: 'result' }
    const success = wrapToolsWithExecutionHooks(
      makeTools(async () => output),
      {}
    )!
    await expect(success.myTool.execute!({}, EXECUTE_OPTIONS)).resolves.toBe(output)

    const error = new Error('aborted')
    const failure = wrapToolsWithExecutionHooks(
      makeTools(async () => {
        throw error
      }),
      {}
    )!
    await expect(failure.myTool.execute!({}, { ...EXECUTE_OPTIONS, abortSignal: AbortSignal.abort() })).rejects.toBe(
      error
    )
    expect(mockMainLoggerService.warn).not.toHaveBeenCalled()
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
})
