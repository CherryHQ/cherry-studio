import { createAnthropic } from '@ai-sdk/anthropic'
import type { LanguageModelV3CallOptions } from '@ai-sdk/provider'
import { describe, expect, it } from 'vitest'

async function send(options: Partial<LanguageModelV3CallOptions>) {
  let body: Record<string, any> = {}
  const model = createAnthropic({
    apiKey: 'test',
    fetch: async (_url, init) => {
      body = JSON.parse(String(init?.body))
      return new Response('{}')
    }
  })('claude-haiku-5-5')
  await model.doStream({
    prompt: [{ role: 'user', content: [{ type: 'text', text: 'Find the answer.' }] }],
    ...options
  })
  return body
}

describe('Haiku 5.5 SDK compatibility', () => {
  it.each(['low', 'medium', 'high', 'xhigh', 'max'] as const)(
    'sends adaptive thinking with summaries at %s effort, without a rejected budget',
    async (effort) => {
      const body = await send({
        providerOptions: { anthropic: { thinking: { type: 'adaptive', display: 'summarized' }, effort } }
      })
      expect(body.thinking).toEqual({ type: 'adaptive', display: 'summarized' })
      expect(body.output_config).toEqual({ effort })
    }
  )

  it.each(['low', 'medium', 'high', 'xhigh', 'max'] as const)(
    'keeps thinking disabled with a valid effort when %s is requested',
    async (effort) => {
      const body = await send({
        providerOptions: { anthropic: { thinking: { type: 'disabled' }, effort } }
      })
      expect(body.thinking).toEqual({ type: 'disabled' })
      expect(body.output_config).toEqual({ effort: effort === 'xhigh' || effort === 'max' ? 'high' : effort })
    }
  )

  it('omits rejected sampling parameters and uses the 128K output limit by default', async () => {
    const body = await send({ temperature: 0.5, topP: 0.9, topK: 20 })
    expect(body.max_tokens).toBe(128000)
    expect(body).not.toHaveProperty('temperature')
    expect(body).not.toHaveProperty('top_p')
    expect(body).not.toHaveProperty('top_k')
  })

  it('uses native structured output and preserves supported forced tool choice', async () => {
    const schema = {
      type: 'object' as const,
      properties: { answer: { type: 'string' as const } },
      required: ['answer']
    }
    const body = await send({ responseFormat: { type: 'json', schema } })
    expect(body.output_config.format).toMatchObject({ type: 'json_schema', schema })
    expect(body.tools).toBeUndefined()

    const toolBody = await send({
      toolChoice: { type: 'tool', toolName: 'lookup' },
      tools: [{ type: 'function', name: 'lookup', inputSchema: { type: 'object', properties: {} } }]
    })
    expect(toolBody.tool_choice).toMatchObject({ type: 'tool', name: 'lookup' })
  })
})
