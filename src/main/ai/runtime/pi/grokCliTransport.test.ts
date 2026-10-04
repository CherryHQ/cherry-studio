import { normalizeContext } from '@earendil-works/pi-ai'
import type { Context, Model } from '@earendil-works/pi-ai'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    OAuthRuntimeService: { getValidAccessToken: async () => ({ accessToken: 'grok-token' }) }
  } as never)
})

import { getProviderTransportAdapter } from '../../provider/runtimeTransport'
import { loadPiAiStreamFns, withTransportStream } from './piTransportStream'

const model: Model<'openai-responses'> = {
  id: 'grok-4.7',
  name: 'Grok 4.7',
  provider: 'grok-cli',
  api: 'openai-responses',
  baseUrl: 'https://cli-chat-proxy.grok.com/v1',
  reasoning: true,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128000,
  maxTokens: 8000
}
const reasoning = { type: 'reasoning', id: 'rs_1', summary: [], encrypted_content: 'opaque' }

describe('Grok CLI Pi transport', () => {
  it('round-trips encrypted-only reasoning and isolates it when switching models', async () => {
    const requests: { body: Record<string, any>; headers: Headers }[] = []
    const fetch: typeof globalThis.fetch = async (_input, init) => {
      requests.push({ body: JSON.parse(init!.body as string), headers: new Headers(init!.headers) })
      const events = [
        { type: 'response.output_item.added', output_index: 0, item: { ...reasoning, encrypted_content: null } },
        { type: 'response.output_item.done', output_index: 0, item: reasoning },
        {
          type: 'response.completed',
          response: { status: 'completed', usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } }
        }
      ]
      return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), {
        headers: { 'content-type': 'text/event-stream' }
      })
    }
    const config = withTransportStream(
      { api: 'openai-responses', models: [] },
      getProviderTransportAdapter('grok-cli')!,
      await loadPiAiStreamFns()
    )
    const context: Context = {
      systemPrompt: 'Be helpful',
      messages: [{ role: 'user', content: 'Hello', timestamp: 0 }]
    }
    const options = { reasoning: 'high' as const, fetch }
    const first = await config.streamSimple!(model, normalizeContext(context), options).result()
    expect(first.stopReason).toBe('stop')
    expect(first.content).toEqual([{ type: 'thinking', thinking: '', thinkingSignature: JSON.stringify(reasoning) }])

    const history = { ...context, messages: [...context.messages, first] }
    await config.streamSimple!(model, normalizeContext(history), options).result()
    await config.streamSimple!({ ...model, id: 'grok-4.6' }, normalizeContext(history), options).result()

    expect(requests[0].headers.get('authorization')).toBe('Bearer grok-token')
    expect(requests[0].headers.get('x-authenticateresponse')).toBe('authenticate-response')
    expect(requests[0].headers.get('x-grok-client-mode')).toBe('interactive')
    expect(requests[0].body).toMatchObject({
      instructions: 'Be helpful',
      reasoning: { effort: 'high' },
      store: false,
      include: ['reasoning.encrypted_content']
    })
    expect(requests[0].body.reasoning).not.toHaveProperty('summary')
    expect(requests[1].body.input.filter((item: Record<string, unknown>) => item.type === 'reasoning')).toEqual([
      reasoning
    ])
    expect(requests[2].body.input.some((item: Record<string, unknown>) => item.type === 'reasoning')).toBe(false)
  })
})
