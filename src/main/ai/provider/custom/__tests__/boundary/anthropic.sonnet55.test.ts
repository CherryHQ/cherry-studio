import { createAnthropic } from '@ai-sdk/anthropic'
import type { LanguageModelV4CallOptions } from '@ai-sdk/provider'
import { describe, expect, it } from 'vitest'

const prompt: LanguageModelV4CallOptions['prompt'] = [
  { role: 'user', content: [{ type: 'text', text: 'Find the answer.' }] }
]

async function send(options: Partial<LanguageModelV4CallOptions>) {
  let body: Record<string, any> = {}
  let headers = new Headers()
  const model = createAnthropic({
    apiKey: 'test',
    fetch: async (_url, init) => {
      body = JSON.parse(String(init?.body))
      headers = new Headers(init?.headers)
      return new Response(
        JSON.stringify({
          id: 'msg_test',
          type: 'message',
          role: 'assistant',
          model: 'claude-sonnet-5-5',
          content: [
            { type: 'thinking', thinking: 'Checking the result.', signature: 'preserved-signature' },
            { type: 'text', text: 'Done.' }
          ],
          stop_reason: 'end_turn',
          usage: { input_tokens: 10, output_tokens: 5 }
        }),
        { headers: { 'content-type': 'application/json' } }
      )
    }
  })('claude-sonnet-5-5')
  const result = await model.doGenerate({ prompt, ...options })
  return { body, headers, result }
}

describe('Sonnet 5.5 SDK compatibility', () => {
  it.each([{ type: 'required' }, { type: 'tool', toolName: 'lookup' }] as const)(
    'avoids rejected forced tool choice: $type',
    async (toolChoice) => {
      const { body } = await send({
        toolChoice,
        tools: [{ type: 'function', name: 'lookup', inputSchema: { type: 'object', properties: {} } }]
      })
      expect(body.tool_choice).toEqual({ type: 'auto' })
      expect(body.tools[0].name).toBe('lookup')
    }
  )

  it('uses native JSON output instead of a forced synthetic tool', async () => {
    const schema = {
      type: 'object' as const,
      properties: { answer: { type: 'string' as const } },
      required: ['answer']
    }
    const { body } = await send({
      responseFormat: { type: 'json', schema },
      providerOptions: { anthropic: { structuredOutputMode: 'jsonTool' } }
    })
    expect(body.output_config.format).toMatchObject({ type: 'json_schema', schema })
    expect(body.tools).toBeUndefined()
    expect(body.tool_choice).toBeUndefined()
  })

  it('limits between-tools effort and omits unsupported sampling parameters', async () => {
    const { body } = await send({
      temperature: 0.5,
      topP: 0.9,
      topK: 20,
      providerOptions: { anthropic: { thinking: { type: 'between_tools' }, effort: 'max' } }
    })
    expect(body.thinking).toEqual({ type: 'between_tools' })
    expect(body.output_config).toEqual({ effort: 'high' })
    expect(body).not.toHaveProperty('temperature')
    expect(body).not.toHaveProperty('top_p')
    expect(body).not.toHaveProperty('top_k')
    expect(body.max_tokens).toBe(128_000)
  })

  it('keeps progress text and its signature available for display and history replay', async () => {
    const { body, result } = await send({
      prompt: [
        ...prompt,
        {
          role: 'assistant',
          content: [
            { type: 'reasoning', text: 'Earlier progress.', providerOptions: { anthropic: { signature: 'earlier' } } },
            { type: 'text', text: 'First answer.' }
          ]
        },
        { role: 'user', content: [{ type: 'text', text: 'Continue.' }] }
      ],
      providerOptions: { anthropic: { thinking: { type: 'adaptive', display: 'summarized' } } }
    })
    expect(body.messages[1].content[0]).toEqual({
      type: 'thinking',
      thinking: 'Earlier progress.',
      signature: 'earlier'
    })
    expect(result.content).toEqual([
      {
        type: 'reasoning',
        text: 'Checking the result.',
        providerMetadata: { anthropic: { signature: 'preserved-signature' } }
      },
      { type: 'text', text: 'Done.' }
    ])
  })

  it('transmits explicit progress-only and thinking-binding options with their beta headers', async () => {
    const { body, headers } = await send({
      providerOptions: {
        anthropic: {
          thinking: { type: 'adaptive', display: 'updates', blockBinding: { prefixMismatchBehavior: 'error' } }
        }
      }
    })
    expect(body.thinking).toEqual({
      type: 'adaptive',
      display: 'updates',
      block_binding: { prefix_mismatch_behavior: 'error' }
    })
    expect(headers.get('anthropic-beta')).toContain('thinking-display-updates-2026-08-18')
    expect(headers.get('anthropic-beta')).toContain('thinking-binding-controls-2026-08-01')
  })

  it('preserves an empty mid-conversation effort update', async () => {
    const { body, headers } = await send({
      prompt: [
        ...prompt,
        { role: 'assistant', content: [{ type: 'text', text: 'First answer.' }] },
        { role: 'system', content: '', providerOptions: { anthropic: { effort: 'xhigh' } } },
        { role: 'user', content: [{ type: 'text', text: 'Continue.' }] }
      ]
    })
    expect(body.messages).toContainEqual(
      expect.objectContaining({ role: 'system', output_config: { effort: 'xhigh' } })
    )
    expect(headers.get('anthropic-beta')).toContain('mid-conversation-output-config-2026-07-01')
  })
})
