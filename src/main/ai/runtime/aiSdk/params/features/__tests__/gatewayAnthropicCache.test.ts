import type { LanguageModelV3CallOptions, LanguageModelV3Usage } from '@ai-sdk/provider'
import type { LanguageModelMiddleware } from 'ai'
import { describe, expect, it } from 'vitest'

import type { Provider } from '@shared/data/types/provider'

import { collectFromFeatures } from '../../collectFromFeatures'
import type { RequestScope } from '../../scope'
import { gatewayAnthropicCacheFeature } from '../gatewayUsageNormalize'

function makeProvider(cacheControl?: Provider['settings']['cacheControl']): Provider {
  return {
    id: 'gateway',
    presetProviderId: 'gateway',
    settings: cacheControl === undefined ? {} : { cacheControl }
  } as Provider
}

function collectMiddleware(provider: Provider): LanguageModelMiddleware {
  const scope = {
    provider,
    model: {},
    endpointType: 'openai-chat-completions',
    aiSdkProviderId: 'gateway'
  } as unknown as RequestScope
  const plugin = collectFromFeatures(scope, [gatewayAnthropicCacheFeature]).modelAdapters[0] as {
    configureContext: (context: { middlewares: LanguageModelMiddleware[] }) => void
  }
  const context = { middlewares: [] as LanguageModelMiddleware[] }
  plugin.configureContext(context)
  return context.middlewares[0]
}

const baseParams = {
  prompt: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }]
} as LanguageModelV3CallOptions

describe('gatewayAnthropicCacheFeature', () => {
  it('enables the gateway caching option so Anthropic breakpoints are placed upstream', async () => {
    const out = await collectMiddleware(makeProvider()).transformParams!({ params: baseParams } as never)

    expect(out.providerOptions?.gateway).toMatchObject({ caching: 'auto' })
  })

  it('keeps the routing options the request already declared', async () => {
    const out = await collectMiddleware(makeProvider()).transformParams!({
      params: { ...baseParams, providerOptions: { gateway: { order: ['anthropic'] } } }
    } as never)

    expect(out.providerOptions?.gateway).toMatchObject({ caching: 'auto', order: ['anthropic'] })
  })

  it('forwards the one-hour lifetime only when the provider asks for it', async () => {
    const defaultTtl = await collectMiddleware(makeProvider()).transformParams!({ params: baseParams } as never)
    const hourTtl = await collectMiddleware(makeProvider({ enabled: true, tokenThreshold: 1024, ttl: '1h' }))
      .transformParams!({ params: baseParams } as never)

    expect(defaultTtl.providerOptions?.gateway?.cache_ttl).toBeUndefined()
    expect(hourTtl.providerOptions?.gateway?.cache_ttl).toBe('1h')
  })

  it('surfaces the Anthropic cache buckets the gateway reports only in raw usage', async () => {
    const middleware = collectMiddleware(makeProvider())
    const usage = {
      inputTokens: 1000,
      outputTokens: 20,
      cachedInputTokens: 900,
      raw: { input_tokens: 1000, output_tokens: 20, cache_read_input_tokens: 900, cache_creation_input_tokens: 80 }
    }

    const result = await middleware.wrapGenerate!({
      doGenerate: async () => ({ usage }) as never
    } as never)

    expect(result.usage.inputTokens).toEqual({
      total: 1000,
      noCache: 100,
      cacheRead: 900,
      cacheWrite: 80
    })
  })

  it('rewrites the nested usage of a stream finish event', async () => {
    const middleware = collectMiddleware(makeProvider())
    const chunk = {
      type: 'finish',
      finishReason: 'stop',
      usage: {
        inputTokens: { total: 500, noCache: 500, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 10, text: 10, reasoning: undefined },
        raw: { cache_read_input_tokens: 400, cache_creation_input_tokens: 0 }
      }
    }
    const { stream } = await middleware.wrapStream!({
      doStream: async () => ({ stream: new ReadableStream({ start: (c) => (c.enqueue(chunk), c.close()) }) })
    } as never)

    const parts: Array<{ usage: LanguageModelV3Usage }> = []
    for await (const part of stream as unknown as AsyncIterable<{ usage: LanguageModelV3Usage }>) parts.push(part)

    expect(parts[0]?.usage.inputTokens).toEqual({ total: 500, noCache: 500, cacheRead: 400, cacheWrite: 0 })
  })
})
