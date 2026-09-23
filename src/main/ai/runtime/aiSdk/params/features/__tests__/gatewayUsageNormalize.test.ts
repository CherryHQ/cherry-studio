import type { LanguageModelMiddleware } from 'ai'
import { describe, expect, it } from 'vitest'

import { gatewayUsageNormalizeFeature, normalizeGatewayUsage } from '../gatewayUsageNormalize'

async function getGatewayUsageNormalizeMiddleware(): Promise<LanguageModelMiddleware> {
  const [plugin] = gatewayUsageNormalizeFeature.contributeModelAdapters!({} as never)
  if (!plugin) throw new Error('gateway usage plugin was not contributed')
  const context = { middlewares: [] as LanguageModelMiddleware[] }
  await plugin.configureContext!(context as never)
  const middleware = context.middlewares[0]
  if (!middleware) throw new Error('gateway usage middleware was not registered')
  return middleware
}

describe('gatewayUsageNormalizeFeature', () => {
  it('runs as the innermost provider adapter for streaming and non-streaming calls', async () => {
    const [plugin] = gatewayUsageNormalizeFeature.contributeModelAdapters!({} as never)
    if (!plugin) throw new Error('gateway usage plugin was not contributed')
    const middleware = await getGatewayUsageNormalizeMiddleware()

    expect(plugin.enforce).toBe('post')
    expect(middleware.wrapGenerate).toBeDefined()
    expect(middleware.wrapStream).toBeDefined()
  })

  it('applies to every provider path', () => {
    expect(gatewayUsageNormalizeFeature.applies!({ sdkConfig: { providerId: 'gateway' } } as never)).toBe(true)
    expect(gatewayUsageNormalizeFeature.applies!({ sdkConfig: { providerId: 'openai' } } as never)).toBe(true)
  })

  it('normalizes non-streaming flat usage', async () => {
    const middleware = await getGatewayUsageNormalizeMiddleware()
    const result = await middleware.wrapGenerate!({
      doGenerate: async () =>
        ({
          usage: { inputTokens: 100, outputTokens: 20, cachedInputTokens: 40 }
        }) as never
    } as never)

    expect(result.usage).toMatchObject({
      inputTokens: { total: 100, noCache: 60, cacheRead: 40 },
      outputTokens: { total: 20 }
    })
  })

  it('re-exports normalizeGatewayUsage for existing callers', () => {
    expect(normalizeGatewayUsage({ inputTokens: 1000, cachedInputTokens: 800, outputTokens: 50 })).toEqual({
      inputTokens: { total: 1000, noCache: 200, cacheRead: 800, cacheWrite: undefined },
      outputTokens: { total: 50, text: undefined, reasoning: undefined }
    })
  })
})
