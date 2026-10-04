import { generateText, isStepCount, tool } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import { describe, expect, it } from 'vitest'
import * as z from 'zod'

import { createToolExecutionHooks } from '../hookRunner'
import type { ToolExecutionEndEvent, ToolExecutionStartEvent } from '../types'

function toolCallingModel() {
  let calls = 0
  return new MockLanguageModelV4({
    doGenerate: async () => ({
      content:
        calls++ === 0
          ? [{ type: 'tool-call', toolCallId: 'call-lookup', toolName: 'lookup', input: '{"query":"  cherries  "}' }]
          : [{ type: 'text', text: 'Finished.' }],
      finishReason: { unified: calls === 1 ? 'tool-calls' : 'stop', raw: undefined },
      usage: {
        inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 2, text: 2, reasoning: 0 }
      },
      warnings: []
    })
  })
}

describe('native tool execution observations', () => {
  it('observes validated input once and the final output after preliminary results', async () => {
    const starts: ToolExecutionStartEvent[] = []
    const ends: ToolExecutionEndEvent[] = []
    const result = await generateText({
      model: toolCallingModel(),
      prompt: 'Look up cherries.',
      tools: {
        lookup: tool({
          inputSchema: z.object({ query: z.string().trim() }),
          execute: async function* ({ query }) {
            yield { query, status: 'loading' }
            yield { query, status: 'ready' }
          }
        })
      },
      stopWhen: isStepCount(2),
      ...createToolExecutionHooks({
        onToolExecutionStart: (event) => {
          starts.push(event)
        },
        onToolExecutionEnd: (event) => {
          ends.push(event)
        }
      })
    })
    expect(result.finalStep.text).toBe('Finished.')
    expect(starts.map(({ callId, input }) => ({ callId, input }))).toEqual([
      { callId: 'call-lookup', input: { query: 'cherries' } }
    ])
    expect(ends).toHaveLength(1)
    expect(ends[0]).toMatchObject({
      callId: 'call-lookup',
      toolName: 'lookup',
      toolOutput: { type: 'tool-result', output: { query: 'cherries', status: 'ready' } }
    })
    expect(ends[0].durationMs).toBeGreaterThanOrEqual(0)
  })

  it('reports a failed execution once even when an observer throws', async () => {
    const ends: ToolExecutionEndEvent[] = []
    const failure = new Error('Lookup unavailable')
    const result = await generateText({
      model: toolCallingModel(),
      prompt: 'Look up cherries.',
      tools: {
        lookup: tool({
          inputSchema: z.object({ query: z.string() }),
          execute: async (): Promise<string> => {
            throw failure
          }
        })
      },
      stopWhen: isStepCount(2),
      ...createToolExecutionHooks({
        onToolExecutionStart: () => {
          throw new Error('Observer failed')
        },
        onToolExecutionEnd: (event) => {
          ends.push(event)
        }
      })
    })
    expect(result.finalStep.text).toBe('Finished.')
    expect(ends).toHaveLength(1)
    expect(ends[0].toolOutput).toMatchObject({ type: 'tool-error', error: failure })
  })
})
