import { createOpenResponses } from '@ai-sdk/open-responses'
import type { LanguageModelV3CallOptions, LanguageModelV3StreamPart } from '@ai-sdk/provider'
import { describe, expect, it } from 'vitest'

/**
 * Guards patches/@ai-sdk__open-responses@1.0.34.patch (backports from 2.0.27):
 * reasoning replay on assistant turns, open-string reasoningEffort, and
 * provider-defined tool passthrough. Thinking-mode dialects (DeepSeek et al.)
 * reject multi-turn requests without the replayed reasoning (#18150).
 */

function makeModel(onBody: (body: any) => void) {
  return createOpenResponses({
    url: 'https://example.com/v1/responses',
    name: 'openai',
    apiKey: 'sk-test',
    fetch: async (_input: RequestInfo | URL, init?: RequestInit) => {
      onBody(JSON.parse(init?.body as string))
      return new Response(
        JSON.stringify({
          id: 'resp_1',
          created_at: 0,
          model: 'deepseek-v4-flash',
          output: [],
          usage: { input_tokens: 1, output_tokens: 1 }
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    }
  })('deepseek-v4-flash')
}

describe('patched @ai-sdk/open-responses', () => {
  it('replays assistant reasoning as reasoning_text content items', async () => {
    let body: any
    await makeModel((b) => (body = b)).doGenerate({
      prompt: [
        {
          role: 'assistant',
          content: [
            { type: 'reasoning', text: 'thinking' },
            { type: 'text', text: 'answer' },
            { type: 'tool-call', toolCallId: 'c1', toolName: 't', input: {} }
          ]
        },
        { role: 'user', content: [{ type: 'text', text: 'next' }] }
      ]
    })

    expect(body.input.filter((item: any) => item.type === 'reasoning')).toEqual([
      { type: 'reasoning', summary: [], content: [{ type: 'reasoning_text', text: 'thinking' }] }
    ])
    // Ark rejects assistant input items without status (400 MissingParameter:
    // input.status, #18253) — mirror of the retired @ai-sdk/openai hunk (#18258).
    expect(body.input.filter((item: any) => item.type === 'message' && item.role === 'assistant')).toEqual([
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'answer' }], status: 'completed' }
    ])
  })

  it('accepts vendor effort tiers outside the upstream enum (deepseek max)', async () => {
    let body: any
    const result = await makeModel((b) => (body = b)).doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      providerOptions: { openai: { reasoningEffort: 'max' } }
    })

    expect(body.reasoning).toEqual({ effort: 'max' })
    expect(result.warnings).toEqual([])
  })

  it('passes provider-defined tools (web_search) through alongside function tools', async () => {
    let body: any
    await makeModel((b) => (body = b)).doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      tools: [
        { type: 'function', name: 'fn', description: undefined, inputSchema: { type: 'object' } },
        { type: 'provider', id: 'openai.web_search', name: 'web_search', args: {} }
      ]
    })

    expect(body.tools).toEqual([
      { type: 'function', name: 'fn', parameters: { type: 'object' } },
      { type: 'web_search' }
    ])
  })

  it('closes an unterminated reasoning item with its real id on stream end', async () => {
    // Upstream flush() hardcoded id 'reasoning-0'; ai's step assembler then errors
    // with "reasoning part reasoning-0 not found" (seen live: HF MiniMax-M2 + tools).
    const events = [
      {
        type: 'response.output_item.added',
        output_index: 0,
        item: { type: 'reasoning', id: 'rs_real' }
      },
      { type: 'response.reasoning_text.delta', item_id: 'rs_real', output_index: 0, delta: 'thinking' },
      {
        type: 'response.completed',
        response: { id: 'resp_1', usage: { input_tokens: 1, output_tokens: 1 } }
      }
    ]
    const body = `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')}data: [DONE]\n\n`
    const model = createOpenResponses({
      url: 'https://example.com/v1/responses',
      name: 'openai',
      apiKey: 'sk-test',
      fetch: async () => new Response(body, { headers: { 'content-type': 'text/event-stream' } })
    })('deepseek-v4-flash')

    const result = await model.doStream({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }]
    })
    const reader = result.stream.getReader()
    const chunks: LanguageModelV3StreamPart[] = []
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
    }

    const ends = chunks.filter((chunk) => chunk.type === 'reasoning-end').map((chunk) => (chunk as any).id)
    expect(ends).toEqual(['rs_real'])
  })

  it('streams response.reasoning_text.delta as reasoning parts (native, load-bearing for DeepSeek)', async () => {
    const events = [
      {
        type: 'response.output_item.added',
        output_index: 0,
        item: { type: 'reasoning', id: 'reasoning-item' }
      },
      { type: 'response.reasoning_text.delta', item_id: 'reasoning-item', output_index: 0, delta: 'First ' },
      { type: 'response.reasoning_text.delta', item_id: 'reasoning-item', output_index: 0, delta: 'step' },
      {
        type: 'response.output_item.done',
        output_index: 0,
        item: { type: 'reasoning', id: 'reasoning-item' }
      },
      {
        type: 'response.completed',
        response: {
          id: 'resp_1',
          usage: { input_tokens: 3, output_tokens: 2 }
        }
      }
    ]
    const body = `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')}data: [DONE]\n\n`
    const model = createOpenResponses({
      url: 'https://example.com/v1/responses',
      name: 'openai',
      apiKey: 'sk-test',
      fetch: async () => new Response(body, { headers: { 'content-type': 'text/event-stream' } })
    })('deepseek-v4-flash')

    const prompt: LanguageModelV3CallOptions['prompt'] = [
      { role: 'user', content: [{ type: 'text', text: 'Think first.' }] }
    ]
    const result = await model.doStream({ prompt })
    const reader = result.stream.getReader()
    const chunks: LanguageModelV3StreamPart[] = []
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
    }

    const deltas = chunks.filter((chunk) => chunk.type === 'reasoning-delta').map((chunk) => (chunk as any).delta)
    expect(deltas.join('')).toBe('First step')
  })
})
