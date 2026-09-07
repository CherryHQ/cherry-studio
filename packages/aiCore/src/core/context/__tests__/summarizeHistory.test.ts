import { describe, expect, it, vi } from 'vitest'

import { summarizeHistory } from '../janitor'
import type { ContextMessage } from '../types'

const slice: ContextMessage[] = [
  { role: 'user', content: 'plan a trip to Kyoto' },
  { role: 'assistant', content: 'Sure — here is a 3-day itinerary ...' }
]

describe('summarizeHistory', () => {
  it('builds the compaction prompt, calls compress, and extracts <summary>', async () => {
    const compress = vi.fn(async (messages: ContextMessage[]) => {
      const last = messages[messages.length - 1]
      expect(last.role).toBe('user')
      // CONTEXT_COMPACTION_INSTRUCTION enforces the <summary> contract
      expect(last.content.toLowerCase()).toContain('summary')
      expect(messages.length).toBe(slice.length + 1) // slice + instruction
      return '<analysis>scratch</analysis><summary>Kyoto 3-day plan</summary>'
    })
    const out = await summarizeHistory(slice, compress)
    expect(compress).toHaveBeenCalledOnce()
    expect(out).toBe('Kyoto 3-day plan')
  })

  it('appends customCompressionInstructions (additive, not replacing)', async () => {
    const compress = vi.fn(async (messages: ContextMessage[]) => {
      const instruction = messages[messages.length - 1].content
      expect(instruction).toContain('Focus on costs')
      // the default scaffolding is still present
      expect(instruction.toLowerCase()).toContain('summary')
      return '<summary>ok</summary>'
    })
    await summarizeHistory(slice, compress, { customCompressionInstructions: 'Focus on costs' })
  })

  it('propagates compress() failures (no internal fallback/circuit breaker)', async () => {
    const compress = vi.fn(async () => {
      throw new Error('model down')
    })
    await expect(summarizeHistory(slice, compress)).rejects.toThrow('model down')
  })

  it('returns empty string for an empty slice without calling the model', async () => {
    const compress = vi.fn(async () => '<summary>should not run</summary>')
    const out = await summarizeHistory([], compress)
    expect(out).toBe('')
    expect(compress).not.toHaveBeenCalled()
  })

  it('appends the instruction as a trailing user message after the slice (order preserved)', async () => {
    // Pin behavior-identity of the extraction: capture what compress receives and
    // assert the instruction is appended as a trailing user message after the slice.
    let captured: ContextMessage[] = []
    const compress = vi.fn(async (messages: ContextMessage[]) => {
      captured = messages
      return '<summary>x</summary>'
    })
    await summarizeHistory(slice, compress)
    // slice preserved in order, instruction appended last
    expect(captured.slice(0, slice.length)).toEqual(slice)
    expect(captured[captured.length - 1].role).toBe('user')
  })

  it('toolResultStubThreshold: 0 stubs oversized tool results (threshold=0 is not falsy)', async () => {
    // Build a slice with a tool message whose content clearly exceeds threshold 0.
    const longContent = 'x'.repeat(200)
    const sliceWithTool: ContextMessage[] = [
      {
        role: 'assistant',
        content: 'Searching now...',
        tool_calls: [{ id: 'call_99', type: 'function', function: { name: 'search', arguments: '{"q":"y"}' } }]
      },
      { role: 'tool', content: longContent, tool_call_id: 'call_99' }
    ]

    const captured: ContextMessage[] = []
    const compress = vi.fn(async (messages: ContextMessage[]) => {
      captured.push(...messages)
      return '<summary>ok</summary>'
    })

    await summarizeHistory(sliceWithTool, compress, { toolResultStubThreshold: 0 })

    // The tool message content should be replaced by the exact stub marker.
    // Exact format from stripLargeToolResultsForCompression:
    //   `[Tool ${name} returned ${content.length} chars; omitted before summarization]`
    const toolEntry = captured.find((m) => m.role === 'tool')
    expect(toolEntry).toBeDefined()
    expect(toolEntry?.content).toBe(`[Tool search returned ${longContent.length} chars; omitted before summarization]`)
    expect(toolEntry?.content).not.toContain(longContent.slice(0, 10))
  })

  it('toolResultStubThreshold: undefined passes tool content through un-stubbed', async () => {
    // Contrast assertion: without toolResultStubThreshold the oversized content is NOT stubbed.
    const longContent = 'y'.repeat(200)
    const sliceWithTool: ContextMessage[] = [
      {
        role: 'assistant',
        content: 'Looking it up...',
        tool_calls: [{ id: 'call_88', type: 'function', function: { name: 'lookup', arguments: '{}' } }]
      },
      { role: 'tool', content: longContent, tool_call_id: 'call_88' }
    ]

    const captured: ContextMessage[] = []
    const compress = vi.fn(async (messages: ContextMessage[]) => {
      captured.push(...messages)
      return '<summary>ok</summary>'
    })

    // No toolResultStubThreshold → guard is `!== undefined`, so undefined skips stripping.
    await summarizeHistory(sliceWithTool, compress)

    const toolEntry = captured.find((m) => m.role === 'tool')
    expect(toolEntry).toBeDefined()
    expect(toolEntry?.content).toBe(longContent)
    expect(toolEntry?.content).not.toContain('omitted before summarization')
  })

  // The summarize call is itself a window-bound request: its input carries whole
  // tool outputs, so un-budgeted it can overflow the compression model's window
  // and come back with no summary at all (runtime finding: 3/5 compactions
  // returned empty). `maxInputTokens` stubs tool results until the input fits.
  describe('maxInputTokens (compression request stays inside the window)', () => {
    const withHugeTool = (chars: number): ContextMessage[] => [
      { role: 'user', content: 'read the repo docs' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'read', arguments: '{}' } }]
      },
      { role: 'tool', content: 'x'.repeat(chars), tool_call_id: 'call_1' }
    ]

    it('stubs oversized tool results when the estimated input exceeds the budget', async () => {
      const captured: ContextMessage[] = []
      const compress = vi.fn(async (messages: ContextMessage[]) => {
        captured.push(...messages)
        return '<summary>ok</summary>'
      })

      await summarizeHistory(withHugeTool(200_000), compress, { maxInputTokens: 4000 })

      const toolEntry = captured.find((m) => m.role === 'tool')
      expect(toolEntry?.content).toContain('omitted before summarization')
      expect(toolEntry?.content.length).toBeLessThan(500)
    })

    it('leaves the slice untouched when it already fits the budget', async () => {
      const captured: ContextMessage[] = []
      const compress = vi.fn(async (messages: ContextMessage[]) => {
        captured.push(...messages)
        return '<summary>ok</summary>'
      })

      await summarizeHistory(withHugeTool(100), compress, { maxInputTokens: 100_000 })

      const toolEntry = captured.find((m) => m.role === 'tool')
      expect(toolEntry?.content).toBe('x'.repeat(100))
    })

    // Stubbing only helps when there ARE tool results. A long prose conversation
    // has no bulk to stub, so the request must still be clamped or it goes out
    // over the window.
    it('clamps prose-only history that stubbing cannot shrink', async () => {
      const prose: ContextMessage[] = [
        { role: 'user', content: 'FIRST — a prior summary the caller leads with' },
        ...Array.from(
          { length: 40 },
          (_, i): ContextMessage => ({
            role: i % 2 === 0 ? 'assistant' : 'user',
            content: `turn ${i}: ${'长篇叙述内容。'.repeat(80)}`
          })
        ),
        { role: 'user', content: 'NEWEST message' }
      ]

      const captured: ContextMessage[] = []
      const compress = vi.fn(async (messages: ContextMessage[]) => {
        captured.push(...messages)
        return '<summary>ok</summary>'
      })

      await summarizeHistory(prose, compress, { maxInputTokens: 3000 })

      expect(captured.length).toBeLessThan(prose.length + 1)
      // first message survives (it may be the accumulated prior summary)
      expect(captured[0].content).toContain('FIRST')
      // the omission is announced, not silent
      expect(captured.some((m) => m.content.includes('omitted'))).toBe(true)
      // the newest turn is kept
      expect(captured.some((m) => m.content.includes('NEWEST'))).toBe(true)
      // and the instruction is still last
      expect(captured[captured.length - 1].content.toLowerCase()).toContain('summary')
    })

    it('is a no-op when maxInputTokens is not supplied (existing behaviour)', async () => {
      const captured: ContextMessage[] = []
      const compress = vi.fn(async (messages: ContextMessage[]) => {
        captured.push(...messages)
        return '<summary>ok</summary>'
      })

      await summarizeHistory(withHugeTool(200_000), compress)

      const toolEntry = captured.find((m) => m.role === 'tool')
      expect(toolEntry?.content).toBe('x'.repeat(200_000))
    })
  })
})
