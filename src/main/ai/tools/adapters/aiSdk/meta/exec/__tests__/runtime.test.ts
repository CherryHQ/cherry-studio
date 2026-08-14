import type { ToolExecutionOptions } from '@ai-sdk/provider-utils'
import type { Tool } from 'ai'
import { describe, expect, it, vi } from 'vitest'

import { ToolRegistry } from '../../../registry'
import type { ToolEntry } from '../../../types'
import { runExec } from '../runtime'

/**
 * `handleToolCall` is an inner closure of `runExec`, driven by the exec worker's
 * `callTool` message. We exercise it end-to-end: `runExec` spawns the real eval
 * worker, the supplied code calls `tools.invoke(name, params)`, and the worker
 * round-trips the call back through `handleToolCall`. The returned `ExecResult`
 * plus the registry tool's `execute` spy let us assert dispatch, refusal, and
 * error propagation without poking at worker internals.
 */

function makeOptions(overrides: Partial<ToolExecutionOptions> = {}): ToolExecutionOptions {
  return {
    toolCallId: 'outer-1',
    messages: [],
    experimental_context: { requestId: 'req-1' },
    ...overrides
  } as ToolExecutionOptions
}

function registryWith(entry: Partial<ToolEntry> & Pick<ToolEntry, 'name' | 'tool'>): ToolRegistry {
  const reg = new ToolRegistry()
  reg.register({
    namespace: 'mcp:s1',
    description: `${entry.name} desc`,
    defer: 'auto',
    ...entry
  })
  return reg
}

function toolWith(overrides: Partial<Tool>): Tool {
  return {
    type: 'function',
    description: 'inner',
    inputSchema: { type: 'object' } as unknown as Tool['inputSchema'],
    ...overrides
  } as Tool
}

describe('runExec / handleToolCall', () => {
  it('dispatches a non-gated invoke to the registry tool and returns its result', async () => {
    const execute = vi.fn().mockResolvedValue({ ok: true })
    const reg = registryWith({ name: 'mcp__s1__t', tool: toolWith({ execute }) })

    const code = `return await tools.invoke('mcp__s1__t', { foo: 'bar' })`
    const out = await runExec(code, { registry: reg, parentOptions: makeOptions() })

    expect(out.isError).toBeFalsy()
    expect(out.result).toEqual({ ok: true })
    expect(execute).toHaveBeenCalledTimes(1)
    expect(execute.mock.calls[0][0]).toEqual({ foo: 'bar' })
  })

  it('nests the toolCallId under the parent so telemetry can rebuild the call tree', async () => {
    const execute = vi.fn().mockResolvedValue('ok')
    const reg = registryWith({ name: 'mcp__s1__t', tool: toolWith({ execute }) })

    const code = `return await tools.invoke('mcp__s1__t', {})`
    await runExec(code, { registry: reg, parentOptions: makeOptions({ toolCallId: 'outer-9' }) })

    const passedOptions = execute.mock.calls[0][1] as ToolExecutionOptions
    expect(passedOptions.toolCallId).toMatch(/^outer-9::exec::/)
  })

  // ── Security backstop: approval-gated tools must be refused, never executed ──
  it('refuses an approval-gated tool and does NOT run its execute', async () => {
    const execute = vi.fn().mockResolvedValue('should-not-run')
    const reg = registryWith({
      name: 'mcp__s1__danger',
      tool: toolWith({ needsApproval: async () => true, execute })
    })

    // The worker rejects the invoke; the code lets it bubble, so runExec returns isError.
    const code = `return await tools.invoke('mcp__s1__danger', { x: 1 })`
    const out = await runExec(code, { registry: reg, parentOptions: makeOptions() })

    expect(out.isError).toBe(true)
    expect(out.error).toMatch(/requires user approval/)
    expect(out.error).toMatch(/call it directly instead of via tool_exec/)
    expect(execute).not.toHaveBeenCalled()
  })

  it('refuses a boolean-gated tool without executing it', async () => {
    const execute = vi.fn().mockResolvedValue('nope')
    const reg = registryWith({
      name: 'mcp__s1__danger',
      tool: toolWith({ needsApproval: true, execute })
    })

    const code = `return await tools.invoke('mcp__s1__danger', {})`
    const out = await runExec(code, { registry: reg, parentOptions: makeOptions() })

    expect(out.isError).toBe(true)
    expect(out.error).toMatch(/requires user approval/)
    expect(execute).not.toHaveBeenCalled()
  })

  it('refuses when the approval gate itself throws (fail-closed) without executing', async () => {
    const execute = vi.fn().mockResolvedValue('nope')
    const reg = registryWith({
      name: 'mcp__s1__danger',
      tool: toolWith({
        needsApproval: async () => {
          throw new Error('policy boom')
        },
        execute
      })
    })

    const code = `return await tools.invoke('mcp__s1__danger', {})`
    const out = await runExec(code, { registry: reg, parentOptions: makeOptions() })

    expect(out.isError).toBe(true)
    expect(out.error).toMatch(/requires user approval/)
    expect(execute).not.toHaveBeenCalled()
  })

  it('reports "Tool not found" for an unregistered name and runs no execute', async () => {
    const execute = vi.fn()
    const reg = registryWith({ name: 'mcp__s1__t', tool: toolWith({ execute }) })

    const code = `return await tools.invoke('mcp__s1__missing', {})`
    const out = await runExec(code, { registry: reg, parentOptions: makeOptions() })

    expect(out.isError).toBe(true)
    expect(out.error).toMatch(/Tool not found: mcp__s1__missing/)
    expect(execute).not.toHaveBeenCalled()
  })

  it('reports "no execute handler" for a tool without an execute fn', async () => {
    const reg = registryWith({ name: 'mcp__s1__inert', tool: toolWith({ execute: undefined }) })

    const code = `return await tools.invoke('mcp__s1__inert', {})`
    const out = await runExec(code, { registry: reg, parentOptions: makeOptions() })

    expect(out.isError).toBe(true)
    expect(out.error).toMatch(/has no execute handler/)
  })

  it('propagates an inner execute rejection back to the caller', async () => {
    const execute = vi.fn().mockRejectedValue(new Error('inner blew up'))
    const reg = registryWith({ name: 'mcp__s1__t', tool: toolWith({ execute }) })

    const code = `return await tools.invoke('mcp__s1__t', {})`
    const out = await runExec(code, { registry: reg, parentOptions: makeOptions() })

    expect(out.isError).toBe(true)
    expect(out.error).toMatch(/inner blew up/)
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('surfaces an error result when the worker code itself throws', async () => {
    const reg = registryWith({ name: 'mcp__s1__t', tool: toolWith({ execute: vi.fn() }) })

    const code = `throw new Error('user code boom')`
    const out = await runExec(code, { registry: reg, parentOptions: makeOptions() })

    expect(out.isError).toBe(true)
    expect(out.error).toMatch(/user code boom/)
  })

  // ── Abort propagation: aborting the parent option signal must reach the child ──
  it('propagates the parent abortSignal to the child signal passed to execute', async () => {
    const parentController = new AbortController()
    let childSignal: AbortSignal | undefined
    let abortedReason: unknown

    const execute = vi.fn().mockImplementation((_params, options: ToolExecutionOptions) => {
      childSignal = options.abortSignal
      return new Promise((resolve) => {
        // Resolve only once the child signal aborts, so we can observe propagation.
        childSignal?.addEventListener('abort', () => {
          abortedReason = childSignal?.reason
          resolve('aborted')
        })
        // Fire the parent abort once execute is in-flight.
        parentController.abort(new Error('parent stop'))
      })
    })

    const reg = registryWith({ name: 'mcp__s1__t', tool: toolWith({ execute }) })
    const code = `return await tools.invoke('mcp__s1__t', {})`
    const out = await runExec(code, {
      registry: reg,
      parentOptions: makeOptions({ abortSignal: parentController.signal })
    })

    expect(childSignal).toBeInstanceOf(AbortSignal)
    expect(childSignal?.aborted).toBe(true)
    expect((abortedReason as Error)?.message).toBe('parent stop')
    expect(out.result).toBe('aborted')
  })

  it('aborts immediately when the parent signal is already aborted before invoke', async () => {
    const parentController = new AbortController()
    parentController.abort(new Error('already done'))

    let childAbortedAtStart: boolean | undefined
    const execute = vi.fn().mockImplementation((_params, options: ToolExecutionOptions) => {
      childAbortedAtStart = options.abortSignal?.aborted
      return 'ok'
    })

    const reg = registryWith({ name: 'mcp__s1__t', tool: toolWith({ execute }) })
    const code = `return await tools.invoke('mcp__s1__t', {})`
    await runExec(code, {
      registry: reg,
      parentOptions: makeOptions({ abortSignal: parentController.signal })
    })

    expect(childAbortedAtStart).toBe(true)
  })

  // ── Timeout: code that never resolves is killed after EXECUTION_TIMEOUT_MS ──
  it('times out, terminates the worker, and finalizes with a timeout error', async () => {
    vi.useFakeTimers()
    try {
      const reg = registryWith({ name: 'mcp__s1__t', tool: toolWith({ execute: vi.fn() }) })
      // Never resolves on its own, so only the 60s timeout can finalize the run.
      const promise = runExec(`await new Promise(() => {})`, {
        registry: reg,
        parentOptions: makeOptions()
      })
      await vi.advanceTimersByTimeAsync(60_000)
      const out = await promise

      expect(out.isError).toBe(true)
      expect(out.error).toMatch(/tool_exec timed out after 60000ms/)
    } finally {
      vi.useRealTimers()
    }
  })

  // ── Worker-level failure: error/exit events finalize the run, not a message ──
  it('finalizes with an error when the worker emits an uncaught error event', async () => {
    const reg = registryWith({ name: 'mcp__s1__t', tool: toolWith({ execute: vi.fn() }) })
    // The throw is scheduled in a later macrotask, so it escapes the worker's own
    // try/catch and surfaces as the worker `error` event; the run never resolves
    // otherwise, so that event is the only path that can finalize it.
    const code = `setTimeout(() => { throw new Error('worker boom') }, 0); await new Promise(() => {})`
    const out = await runExec(code, { registry: reg, parentOptions: makeOptions() })

    expect(out.isError).toBe(true)
    expect(out.error).toMatch(/worker boom/)
  })

  it('finalizes with an error when the worker exits unexpectedly', async () => {
    const reg = registryWith({ name: 'mcp__s1__t', tool: toolWith({ execute: vi.fn() }) })
    // `process.exit` inside a worker thread stops only that worker (exit code 1),
    // so the `exit` handler — not a posted result — finalizes the run.
    const out = await runExec(`process.exit(1)`, { registry: reg, parentOptions: makeOptions() })

    expect(out.isError).toBe(true)
    expect(out.error).toMatch(/exec worker exited with code 1/)
  })
})
