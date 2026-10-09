import type { LanguageModelV3CallOptions, LanguageModelV3StreamPart } from '@ai-sdk/provider'
import { Type } from '@earendil-works/pi-ai'
import { defineTool } from '@earendil-works/pi-coding-agent'
import { simulateReadableStream } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'
import { describe, expect, it } from 'vitest'

import { createTestSession, finish, lastAssistant, MODEL, scriptedModel, streamTextPort, textParts } from './support'

const PAGE_CHARS = 9_000 // ~2.6k tokens per tool result

/** Reports a realistic prompt size so Pi's usage-anchored context accounting sees real growth. */
const sizedFinish = (unified: 'stop' | 'tool-calls', prompt: unknown): LanguageModelV3StreamPart => {
  const input = Math.ceil(JSON.stringify(prompt).length / 3.5)
  return {
    type: 'finish',
    usage: {
      inputTokens: { total: input, noCache: input, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 20, text: 20, reasoning: undefined }
    },
    finishReason: { unified, raw: unified }
  }
}

describe('Pi compaction through the port', () => {
  it('summarizes through the bridged model and sends the summary in place of the compacted history', async () => {
    const { model, calls } = scriptedModel([
      [...textParts('a', 'Answer one.'), finish('stop')],
      [...textParts('b', 'Answer two.'), finish('stop')],
      [...textParts('s', '## Goal\nUser is Li from Paris.'), finish('stop')],
      [...textParts('c', 'Answer three.'), finish('stop')]
    ])
    const { session } = await createTestSession({
      port: streamTextPort(model).port,
      settings: { compaction: { keepRecentTokens: 1 } }
    })
    await session.prompt('Question one, my name is Li')
    await session.prompt('Question two, I live in Paris')
    const result = await session.compact('keep the user facts')
    await session.prompt('Question three')

    expect(result.summary).toMatch(/Li from Paris/)
    const lastPrompt = JSON.stringify(calls.at(-1)!.prompt)
    expect(lastPrompt).toMatch(/Li from Paris/)
    expect(lastPrompt).not.toMatch(/Question one/)
  })

  it('compacts inside the tool loop before the next model request', async () => {
    const timeline: string[] = []
    const agentCalls: LanguageModelV3CallOptions[] = []
    const model = new MockLanguageModelV3({
      doStream: async (options) => {
        let chunks: LanguageModelV3StreamPart[]
        if ((options.tools ?? []).length === 0) {
          timeline.push('model:summarize')
          chunks = [
            ...textParts('s', '## Progress\nRead pages 1-2: SUMMARY-MARKER.'),
            sizedFinish('stop', options.prompt)
          ]
        } else {
          agentCalls.push(options)
          const step = agentCalls.length
          timeline.push(`model:agent#${step}`)
          chunks =
            step <= 3
              ? [
                  {
                    type: 'tool-call',
                    toolCallId: `call_${step}`,
                    toolName: 'fetch_page',
                    input: JSON.stringify({ page: step })
                  },
                  sizedFinish('tool-calls', options.prompt)
                ]
              : [...textParts('t', 'Done reading.'), sizedFinish('stop', options.prompt)]
        }
        return { stream: simulateReadableStream({ chunks }) }
      }
    })
    const fetchPage = defineTool({
      name: 'fetch_page',
      label: 'Fetch page',
      description: 'Fetch one page of a long document',
      parameters: Type.Object({ page: Type.Number() }),
      async execute(_id, params) {
        return {
          content: [{ type: 'text', text: `PAGE-${params.page} ` + 'x'.repeat(PAGE_CHARS) }],
          details: undefined
        }
      }
    })
    const { session } = await createTestSession({
      port: streamTextPort(model).port,
      model: { ...MODEL, contextWindow: 9_000 },
      tools: [fetchPage],
      // threshold = contextWindow - reserveTokens = 7k tokens; three pages (~8k) cross it.
      settings: { compaction: { enabled: true, reserveTokens: 2_000, keepRecentTokens: 3_000 } }
    })
    session.subscribe((event) => {
      if (event.type === 'tool_execution_end') timeline.push('tool:end')
      if (event.type === 'compaction_start') timeline.push(`compaction:start:${event.reason}`)
      if (event.type === 'compaction_end') timeline.push('compaction:end')
    })
    await session.prompt('Read pages 1-3 and tell me when done.')

    expect(timeline).toEqual([
      'model:agent#1',
      'tool:end',
      'model:agent#2',
      'tool:end',
      'model:agent#3',
      'tool:end',
      'compaction:start:threshold',
      'model:summarize',
      'compaction:end',
      'model:agent#4'
    ])
    const finalPrompt = JSON.stringify(agentCalls[3].prompt)
    expect(finalPrompt).toMatch(/SUMMARY-MARKER/)
    expect(finalPrompt).not.toMatch(/PAGE-1 /)
    expect(finalPrompt.length).toBeLessThan(JSON.stringify(agentCalls[2].prompt).length)
    expect(lastAssistant(session).content).toEqual([{ type: 'text', text: 'Done reading.' }])
  })
})
