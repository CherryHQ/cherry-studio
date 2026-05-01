import type { LanguageModelUsage, StepResult, ToolSet } from 'ai'
import { describe, expect, it, vi } from 'vitest'

import type {
  AgentLoopHooks,
  ErrorContext,
  IterationContext,
  IterationResult,
  LoopFinishResult,
  ToolExecutionEndEvent,
  ToolExecutionStartEvent
} from '../../loop'
import { composeHooks } from '../composeHooks'

const ITERATION_CTX: IterationContext = { iterationNumber: 1, messages: [], totalSteps: 0 }

const ZERO_USAGE: LanguageModelUsage = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  inputTokenDetails: { noCacheTokens: undefined, cacheReadTokens: undefined, cacheWriteTokens: undefined },
  outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined }
}

const ITERATION_RESULT: IterationResult = {
  messages: [],
  usage: ZERO_USAGE,
  finishReason: 'stop',
  steps: [],
  response: { id: 'r1', modelId: 'm1', timestamp: new Date(0) },
  sources: []
}

const FINISH_RESULT: LoopFinishResult = {
  totalUsage: ZERO_USAGE,
  totalIterations: 1,
  totalSteps: 0,
  finishReason: 'stop'
}

const TOOL_START_EVENT: ToolExecutionStartEvent = {
  callId: 'c1',
  toolName: 't1',
  input: {},
  messages: []
}

const TOOL_END_EVENT: ToolExecutionEndEvent = {
  ...TOOL_START_EVENT,
  durationMs: 1,
  toolOutput: { type: 'tool-result', output: 'ok' }
}

describe('composeHooks', () => {
  it('returns empty hooks for zero parts', () => {
    expect(composeHooks([])).toEqual({})
  })

  it('returns the part as-is when there is exactly one', () => {
    const onStart = vi.fn()
    const part: Partial<AgentLoopHooks> = { onStart }
    expect(composeHooks([part])).toBe(part)
  })

  describe('void hooks (onStart / onStepFinish / onTool* / onFinish)', () => {
    it('runs all void hooks in declaration order', async () => {
      const calls: string[] = []
      const composed = composeHooks([
        { onStart: () => void calls.push('a') },
        { onStart: async () => void calls.push('b') },
        { onStart: () => void calls.push('c') }
      ])
      await composed.onStart!()
      expect(calls).toEqual(['a', 'b', 'c'])
    })

    it('skips parts that omit the void hook', async () => {
      const a = vi.fn()
      const c = vi.fn()
      const composed = composeHooks([{ onFinish: a }, {}, { onFinish: c }])
      await composed.onFinish!(FINISH_RESULT)
      expect(a).toHaveBeenCalledTimes(1)
      expect(c).toHaveBeenCalledTimes(1)
    })

    it('returns undefined when no part defines the void hook', () => {
      const composed = composeHooks([{ onStart: () => {} }, { onFinish: () => {} }])
      expect(composed.onStepFinish).toBeUndefined()
    })

    it('forwards args to all listeners (tool execution events)', async () => {
      const start1 = vi.fn()
      const start2 = vi.fn()
      const end1 = vi.fn()
      const composed = composeHooks([
        { onToolExecutionStart: start1, onToolExecutionEnd: end1 },
        { onToolExecutionStart: start2 }
      ])
      await composed.onToolExecutionStart!(TOOL_START_EVENT)
      await composed.onToolExecutionEnd!(TOOL_END_EVENT)
      expect(start1).toHaveBeenCalledWith(TOOL_START_EVENT)
      expect(start2).toHaveBeenCalledWith(TOOL_START_EVENT)
      expect(end1).toHaveBeenCalledWith(TOOL_END_EVENT)
    })

    it('forwards onStepFinish step argument', async () => {
      const a = vi.fn()
      const b = vi.fn()
      const composed = composeHooks([{ onStepFinish: a }, { onStepFinish: b }])
      const step = { text: 'x' } as unknown as StepResult<ToolSet>
      await composed.onStepFinish!(step)
      expect(a).toHaveBeenCalledWith(step)
      expect(b).toHaveBeenCalledWith(step)
    })

    it('isolates per-hook throws — later hooks still run', async () => {
      const a = vi.fn(() => {
        throw new Error('boom')
      })
      const b = vi.fn()
      const composed = composeHooks([{ onFinish: a }, { onFinish: b }])
      await composed.onFinish!(FINISH_RESULT)
      expect(a).toHaveBeenCalledTimes(1)
      expect(b).toHaveBeenCalledTimes(1)
    })
  })

  describe('beforeIteration', () => {
    it('merges results across parts (later wins on each field)', async () => {
      const composed = composeHooks([
        { beforeIteration: () => ({ system: 'first' }) },
        { beforeIteration: () => ({ messages: [{ id: 'm', role: 'user', parts: [] }] }) },
        { beforeIteration: () => ({ system: 'last' }) }
      ])
      const result = await composed.beforeIteration!(ITERATION_CTX)
      expect(result).toEqual({
        system: 'last',
        messages: [{ id: 'm', role: 'user', parts: [] }]
      })
    })

    it('returns undefined when all parts return nothing', async () => {
      const composed = composeHooks([{ beforeIteration: () => undefined }, { beforeIteration: () => undefined }])
      expect(await composed.beforeIteration!(ITERATION_CTX)).toBeUndefined()
    })

    it('passes the iteration context to each part', async () => {
      const a = vi.fn(() => undefined)
      const b = vi.fn(() => undefined)
      const composed = composeHooks([{ beforeIteration: a }, { beforeIteration: b }])
      await composed.beforeIteration!(ITERATION_CTX)
      expect(a).toHaveBeenCalledWith(ITERATION_CTX)
      expect(b).toHaveBeenCalledWith(ITERATION_CTX)
    })
  })

  describe('afterIteration', () => {
    it('returns true if any part returns true (OR semantics)', async () => {
      const composed = composeHooks([
        { afterIteration: () => false },
        { afterIteration: () => true },
        { afterIteration: () => undefined }
      ])
      expect(await composed.afterIteration!(ITERATION_CTX, ITERATION_RESULT)).toBe(true)
    })

    it('returns false when no part returns true', async () => {
      const composed = composeHooks([{ afterIteration: () => false }, { afterIteration: () => undefined }])
      expect(await composed.afterIteration!(ITERATION_CTX, ITERATION_RESULT)).toBe(false)
    })

    it('runs every part even after a true (so side effects always fire)', async () => {
      const a = vi.fn(() => true)
      const b = vi.fn(() => false)
      const composed = composeHooks([{ afterIteration: a }, { afterIteration: b }])
      await composed.afterIteration!(ITERATION_CTX, ITERATION_RESULT)
      expect(a).toHaveBeenCalledTimes(1)
      expect(b).toHaveBeenCalledTimes(1)
    })
  })

  describe('onError', () => {
    it("returns 'retry' if any part returns 'retry'", async () => {
      const composed = composeHooks([
        { onError: () => 'abort' as const },
        { onError: () => 'retry' as const },
        { onError: () => 'abort' as const }
      ])
      const ctx: ErrorContext = { iterationNumber: 1, error: new Error('x') }
      expect(await composed.onError!(ctx)).toBe('retry')
    })

    it("defaults to 'abort' when no part returns 'retry'", async () => {
      const composed = composeHooks([{ onError: () => 'abort' as const }, { onError: () => 'abort' as const }])
      const ctx: ErrorContext = { iterationNumber: 1, error: new Error('x') }
      expect(await composed.onError!(ctx)).toBe('abort')
    })

    it('runs every part even after a retry decision', async () => {
      const a = vi.fn(() => 'retry' as const)
      const b = vi.fn(() => 'abort' as const)
      const composed = composeHooks([{ onError: a }, { onError: b }])
      const ctx: ErrorContext = { iterationNumber: 1, error: new Error('x') }
      await composed.onError!(ctx)
      expect(a).toHaveBeenCalledTimes(1)
      expect(b).toHaveBeenCalledTimes(1)
    })
  })

  describe('prepareStep', () => {
    it('keeps the only prepareStep when one part defines it', () => {
      const fn = vi.fn()
      const composed = composeHooks([{ prepareStep: fn }, {}])
      expect(composed.prepareStep).toBe(fn)
    })

    it('uses the last prepareStep when multiple parts define it', () => {
      const a = vi.fn()
      const b = vi.fn()
      const c = vi.fn()
      const composed = composeHooks([{ prepareStep: a }, { prepareStep: b }, { prepareStep: c }])
      expect(composed.prepareStep).toBe(c)
    })

    it('returns undefined when no part defines prepareStep', () => {
      const composed = composeHooks([{ onStart: () => {} }, { onFinish: () => {} }])
      expect(composed.prepareStep).toBeUndefined()
    })
  })
})
