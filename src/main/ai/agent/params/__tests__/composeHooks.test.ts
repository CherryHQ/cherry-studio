import type { ModelMessage, StepResult, ToolSet } from 'ai'
import { describe, expect, it, vi } from 'vitest'

import type { AgentLoopHooks, ErrorContext, ToolExecutionEndEvent, ToolExecutionStartEvent } from '../../loop'
import { composeHooks } from '../composeHooks'

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
      await composed.onFinish!()
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
      await composed.onFinish!()
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
      const ctx: ErrorContext = { error: new Error('x') }
      expect(await composed.onError!(ctx)).toBe('retry')
    })

    it("defaults to 'abort' when no part returns 'retry'", async () => {
      const composed = composeHooks([{ onError: () => 'abort' as const }, { onError: () => 'abort' as const }])
      const ctx: ErrorContext = { error: new Error('x') }
      expect(await composed.onError!(ctx)).toBe('abort')
    })

    it('runs every part even after a retry decision', async () => {
      const a = vi.fn(() => 'retry' as const)
      const b = vi.fn(() => 'abort' as const)
      const composed = composeHooks([{ onError: a }, { onError: b }])
      const ctx: ErrorContext = { error: new Error('x') }
      await composed.onError!(ctx)
      expect(a).toHaveBeenCalledTimes(1)
      expect(b).toHaveBeenCalledTimes(1)
    })
  })

  describe('prepareStep', () => {
    const baseOptions = {
      stepNumber: 0,
      steps: [],
      messages: [{ role: 'user', content: 'hi' } as ModelMessage],
      model: { modelId: 'fake' } as never,
      experimental_context: undefined
    }

    it('keeps the only prepareStep when one part defines it', () => {
      const fn = vi.fn()
      const composed = composeHooks([{ prepareStep: fn }, {}])
      expect(composed.prepareStep).toBe(fn)
    })

    it('chains prepareStep — each part sees the previous mutation', async () => {
      const a = vi.fn(({ messages }) =>
        Promise.resolve({ messages: [...messages, { role: 'user', content: 'a' } as ModelMessage] })
      )
      const b = vi.fn(({ messages }) =>
        Promise.resolve({ messages: [...messages, { role: 'user', content: 'b' } as ModelMessage] })
      )
      const composed = composeHooks([{ prepareStep: a }, { prepareStep: b }])
      const result = await composed.prepareStep!(baseOptions)
      // b saw a's appended message, so its messages array has both
      const seenByB = b.mock.calls[0][0].messages
      expect(seenByB.map((m: ModelMessage) => m.content)).toEqual(['hi', 'a'])
      // final merged result holds b's appended-twice array
      expect((result?.messages ?? []).map((m: ModelMessage) => m.content)).toEqual(['hi', 'a', 'b'])
    })

    it('merges non-messages keys across parts (later wins)', async () => {
      const composed = composeHooks([
        { prepareStep: () => Promise.resolve({ system: 'first', toolChoice: 'auto' as const }) },
        { prepareStep: () => Promise.resolve({ system: 'last' }) }
      ])
      const result = await composed.prepareStep!(baseOptions)
      expect(result).toMatchObject({ system: 'last', toolChoice: 'auto' })
    })

    it('returns undefined when no part defines prepareStep', () => {
      const composed = composeHooks([{ onStart: () => {} }, { onFinish: () => {} }])
      expect(composed.prepareStep).toBeUndefined()
    })
  })
})
