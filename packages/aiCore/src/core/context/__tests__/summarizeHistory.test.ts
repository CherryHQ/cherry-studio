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
})
