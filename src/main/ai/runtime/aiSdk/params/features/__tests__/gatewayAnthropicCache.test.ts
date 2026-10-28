import type { LanguageModelV3CallOptions } from '@ai-sdk/provider'
import type { LanguageModelMiddleware } from 'ai'
import { describe, expect, it } from 'vitest'

import type { AiPlugin, AiRequestContext } from '@cherrystudio/ai-core'
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

async function collectMiddleware(provider: Provider): Promise<LanguageModelMiddleware> {
  const scope = {
    provider,
    model: {},
    endpointType: 'openai-chat-completions',
    aiSdkProviderId: 'gateway'
  } as unknown as RequestScope
  const plugin: AiPlugin = collectFromFeatures(scope, [gatewayAnthropicCacheFeature]).modelAdapters[0]
  // The callback only reads `middlewares`; the rest of the request context is unused here.
  const context = { middlewares: [] as LanguageModelMiddleware[] } as unknown as AiRequestContext
  await plugin.configureContext?.(context)
  const middleware = context.middlewares?.[0]
  if (!middleware) throw new Error('expected gatewayAnthropicCacheFeature to register a middleware')
  return middleware
}

const baseParams = {
  prompt: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }]
} as LanguageModelV3CallOptions

describe('gatewayAnthropicCacheFeature', () => {
  it('enables the gateway caching option so Anthropic breakpoints are placed upstream', async () => {
    const out = await (await collectMiddleware(makeProvider())).transformParams!({ params: baseParams } as never)

    expect(out.providerOptions?.gateway).toMatchObject({ caching: 'auto' })
  })

  it('keeps the routing options the request already declared', async () => {
    const out = await (
      await collectMiddleware(makeProvider())
    ).transformParams!({
      params: { ...baseParams, providerOptions: { gateway: { order: ['anthropic'] } } }
    } as never)

    expect(out.providerOptions?.gateway).toMatchObject({ caching: 'auto', order: ['anthropic'] })
  })

  it('forwards the one-hour lifetime only when the provider asks for it', async () => {
    const defaultTtl = await (await collectMiddleware(makeProvider())).transformParams!({ params: baseParams } as never)
    const hourTtl = await (
      await collectMiddleware(makeProvider({ enabled: true, tokenThreshold: 1024, ttl: '1h' }))
    ).transformParams!({ params: baseParams } as never)

    expect(defaultTtl.providerOptions?.gateway?.cache_ttl).toBeUndefined()
    expect(hourTtl.providerOptions?.gateway?.cache_ttl).toBe('1h')
  })

  it('does not rewrite usage: reconciliation lives in the innermost usage normalize', async () => {
    const middleware = await collectMiddleware(makeProvider())

    expect(middleware.wrapGenerate).toBeUndefined()
    expect(middleware.wrapStream).toBeUndefined()
  })
})
