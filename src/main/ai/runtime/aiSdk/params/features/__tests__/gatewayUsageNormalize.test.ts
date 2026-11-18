import type { LanguageModelV3StreamPart } from '@ai-sdk/provider'
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

describe('raw Anthropic cache bucket reconciliation', () => {
  it.each([
    ['nested write', { prompt_tokens_details: { cache_creation_tokens: 80 } }, 1000, 0, 920, 0, 80],
    ['nested read', { prompt_tokens_details: { cache_read_tokens: 900 } }, 1000, 0, 100, 900, undefined],
    [
      'nested read and write',
      { prompt_tokens_details: { cache_read_tokens: 900, cache_creation_tokens: 80 } },
      1000,
      0,
      20,
      900,
      80
    ],
    [
      'canonical read and nested write',
      { prompt_tokens_details: { cached_tokens: 900, cache_creation_tokens: 80 } },
      1000,
      900,
      20,
      900,
      80
    ],
    [
      'canonical read beats alias',
      { prompt_tokens_details: { cached_tokens: 900, cache_read_tokens: 100 } },
      1000,
      900,
      100,
      900,
      undefined
    ],
    [
      'canonical zero beats alias',
      { prompt_tokens_details: { cached_tokens: 0, cache_read_tokens: 900 } },
      1000,
      0,
      1000,
      0,
      undefined
    ],
    [
      'top-level read zero beats alias',
      { cache_read_input_tokens: 0, prompt_tokens_details: { cache_read_tokens: 900 } },
      1000,
      0,
      1000,
      0,
      undefined
    ],
    [
      'top-level write zero beats alias',
      { cache_creation_input_tokens: 0, prompt_tokens_details: { cache_creation_tokens: 80 } },
      1000,
      0,
      1000,
      0,
      0
    ],
    [
      'explicit nested zeros',
      { prompt_tokens_details: { cache_read_tokens: 0, cache_creation_tokens: 0 } },
      1000,
      0,
      1000,
      0,
      0
    ],
    [
      'reject both contradictory aliases',
      { prompt_tokens_details: { cache_read_tokens: 900, cache_creation_tokens: 200 } },
      1000,
      0,
      1000,
      0,
      undefined
    ],
    [
      'reject write while retaining SDK canonical split',
      { prompt_tokens_details: { cached_tokens: 900, cache_creation_tokens: 200 } },
      1000,
      900,
      100,
      900,
      undefined
    ],
    [
      'reject write larger than a small prompt',
      { prompt_tokens_details: { cache_creation_tokens: 155712 } },
      8,
      0,
      8,
      0,
      undefined
    ],
    [
      'do not fall back after canonical read contradicts total',
      { prompt_tokens_details: { cached_tokens: 1100, cache_read_tokens: 900 } },
      1000,
      0,
      1000,
      0,
      undefined
    ],
    [
      'top-level buckets beat canonical and alias values',
      {
        cache_read_input_tokens: 20,
        cache_creation_input_tokens: 30,
        prompt_tokens_details: { cached_tokens: 900, cache_read_tokens: 800, cache_creation_tokens: 80 }
      },
      1000,
      900,
      950,
      20,
      30
    ]
  ] as const)('%s', async (_name, raw, total, normalizedRead, noCache, cacheRead, cacheWrite) => {
    const middleware = await getGatewayUsageNormalizeMiddleware()
    const usage = {
      inputTokens: { total, noCache: total - normalizedRead, cacheRead: normalizedRead, cacheWrite: undefined },
      outputTokens: { total: 20, text: 15, reasoning: 5 },
      raw
    }
    const result = await middleware.wrapGenerate!({ doGenerate: async () => ({ usage }) as never } as never)

    expect(result.usage.inputTokens).toEqual({ total, noCache, cacheRead, cacheWrite })
    expect(result.usage.raw).toBe(raw)
    expect(result.usage.outputTokens).toBe(usage.outputTokens)
  })

  it.each([
    {},
    { prompt_tokens_details: {} },
    { prompt_tokens_details: { cached_tokens: null, cache_read_tokens: '900', cache_creation_tokens: null } },
    { prompt_tokens_details: null },
    { prompt_tokens_details: [] }
  ])('preserves the original usage when raw has no numeric cache keys: %j', async (raw) => {
    const middleware = await getGatewayUsageNormalizeMiddleware()
    const usage = {
      inputTokens: { total: 1000, noCache: 1000, cacheRead: 0, cacheWrite: undefined },
      outputTokens: { total: 20 },
      raw
    }
    const result = await middleware.wrapGenerate!({ doGenerate: async () => ({ usage }) as never } as never)

    expect(result.usage).toBe(usage)
    expect(result.usage.inputTokens).toEqual({ total: 1000, noCache: 1000, cacheRead: 0, cacheWrite: undefined })
  })

  it('preserves unknown total and reported noCache while recovering a nested write', async () => {
    const middleware = await getGatewayUsageNormalizeMiddleware()
    const usage = {
      inputTokens: { total: undefined, noCache: 300, cacheRead: 10, cacheWrite: undefined },
      outputTokens: { total: 20 },
      raw: { prompt_tokens_details: { cache_creation_tokens: 80 } }
    }
    const result = await middleware.wrapGenerate!({ doGenerate: async () => ({ usage }) as never } as never)

    expect(result.usage.inputTokens).toEqual({ total: undefined, noCache: 300, cacheRead: 10, cacheWrite: 80 })
  })

  it('recovers nested aliases on stream finish without changing other event fields', async () => {
    const middleware = await getGatewayUsageNormalizeMiddleware()
    const chunk = {
      type: 'finish',
      finishReason: { unified: 'stop', raw: 'stop' },
      providerMetadata: { compatible: { requestId: 'cache-aliases' } },
      usage: {
        inputTokens: { total: 1000, noCache: 1000, cacheRead: 0, cacheWrite: undefined },
        outputTokens: { total: 20, text: 15, reasoning: 5 },
        raw: { prompt_tokens_details: { cache_read_tokens: 900, cache_creation_tokens: 80 } }
      }
    }
    const text = { type: 'text-delta', id: 'text-1', delta: 'ok' }
    const { stream } = await middleware.wrapStream!({
      doStream: async () => ({
        stream: new ReadableStream({
          start: (c) => {
            c.enqueue(text)
            c.enqueue(chunk)
            c.close()
          }
        })
      })
    } as never)
    const parts: LanguageModelV3StreamPart[] = []
    for await (const part of stream) parts.push(part)

    expect(parts[0]).toBe(text)
    expect(parts[1]).toEqual({
      ...chunk,
      usage: { ...chunk.usage, inputTokens: { total: 1000, noCache: 20, cacheRead: 900, cacheWrite: 80 } }
    })
  })

  // Genuine Anthropic semantics: raw input_tokens is the UNCACHED count; the gateway's flat
  // inputTokens is the prompt total inclusive of the cache buckets.
  it('reconciles noCache and surfaces raw buckets from flat gateway usage', async () => {
    const middleware = await getGatewayUsageNormalizeMiddleware()
    const usage = {
      inputTokens: 1000,
      outputTokens: 20,
      cachedInputTokens: 900,
      raw: { input_tokens: 20, output_tokens: 20, cache_read_input_tokens: 900, cache_creation_input_tokens: 80 }
    }

    const result = await middleware.wrapGenerate!({ doGenerate: async () => ({ usage }) as never } as never)

    // noCache = 1000 total - 900 reads - 80 writes: the buckets sum to the prompt total.
    expect(result.usage.inputTokens).toEqual({ total: 1000, noCache: 20, cacheRead: 900, cacheWrite: 80 })
  })

  it('keeps the flat-derived read when raw carries only a write bucket', async () => {
    const middleware = await getGatewayUsageNormalizeMiddleware()
    const usage = {
      inputTokens: 1000,
      outputTokens: 20,
      cachedInputTokens: 900,
      raw: { input_tokens: 20, output_tokens: 20, cache_creation_input_tokens: 80 }
    }

    const result = await middleware.wrapGenerate!({ doGenerate: async () => ({ usage }) as never } as never)

    expect(result.usage.inputTokens).toEqual({ total: 1000, noCache: 20, cacheRead: 900, cacheWrite: 80 })
  })

  it('reconciles a write-only raw bucket when read metadata is omitted', async () => {
    const middleware = await getGatewayUsageNormalizeMiddleware()
    const usage = {
      inputTokens: { total: 1000, noCache: 1000 },
      outputTokens: { total: 20 },
      raw: { input_tokens: 920, output_tokens: 20, cache_creation_input_tokens: 80 }
    }

    const result = await middleware.wrapGenerate!({ doGenerate: async () => ({ usage }) as never } as never)

    // The 80 write tokens displace uncached input: left unreconciled, local cost analytics
    // would count them on top of the reported noCache (1080 priced units for 1000 prompt tokens).
    expect(result.usage.inputTokens).toEqual({ total: 1000, noCache: 920, cacheWrite: 80 })
  })

  it('drops a write-only raw bucket that contradicts the prompt total', async () => {
    const middleware = await getGatewayUsageNormalizeMiddleware()
    const usage = {
      inputTokens: { total: 1000, noCache: 1000 },
      outputTokens: { total: 20 },
      raw: { input_tokens: 1000, output_tokens: 20, cache_creation_input_tokens: 1200 }
    }

    const result = await middleware.wrapGenerate!({ doGenerate: async () => ({ usage }) as never } as never)

    // 1200 > 1000: inconsistent raw, the provider-reported split stands.
    expect(result.usage.inputTokens).toEqual({ total: 1000, noCache: 1000 })
  })

  it('drops raw buckets that contradict the prompt total', async () => {
    const middleware = await getGatewayUsageNormalizeMiddleware()
    const usage = {
      inputTokens: 1000,
      outputTokens: 20,
      cachedInputTokens: 900,
      raw: { cache_read_input_tokens: 1200, cache_creation_input_tokens: 100 }
    }

    const result = await middleware.wrapGenerate!({ doGenerate: async () => ({ usage }) as never } as never)

    // 1200 + 100 > 1000: inconsistent raw, the provider-reported flat split stands.
    expect(result.usage.inputTokens).toEqual({ total: 1000, noCache: 100, cacheRead: 900, cacheWrite: undefined })
  })

  it('is idempotent on native Anthropic nested usage', async () => {
    const middleware = await getGatewayUsageNormalizeMiddleware()
    // Native shape from @ai-sdk/anthropic: total = noCache + read + write already.
    const usage = {
      inputTokens: { total: 1980, noCache: 1000, cacheRead: 900, cacheWrite: 80 },
      outputTokens: { total: 20, text: 20, reasoning: undefined },
      raw: { input_tokens: 1000, cache_read_input_tokens: 900, cache_creation_input_tokens: 80 }
    }

    const result = await middleware.wrapGenerate!({ doGenerate: async () => ({ usage }) as never } as never)

    expect(result.usage.inputTokens).toEqual({ total: 1980, noCache: 1000, cacheRead: 900, cacheWrite: 80 })
  })

  it('leaves usage without raw untouched', async () => {
    const middleware = await getGatewayUsageNormalizeMiddleware()
    const usage = { inputTokens: 42, outputTokens: 7 }

    const result = await middleware.wrapGenerate!({ doGenerate: async () => ({ usage }) as never } as never)

    expect(result.usage.inputTokens).toEqual({
      total: 42,
      noCache: undefined,
      cacheRead: undefined,
      cacheWrite: undefined
    })
  })

  it('surfaces buckets without recomputing noCache when the total is unknown', async () => {
    const middleware = await getGatewayUsageNormalizeMiddleware()
    const usage = {
      inputTokens: { total: undefined, noCache: 300, cacheRead: 10, cacheWrite: undefined },
      outputTokens: { total: 5, text: 5, reasoning: undefined },
      raw: { cache_read_input_tokens: 10, cache_creation_input_tokens: 0 }
    }

    const result = await middleware.wrapGenerate!({ doGenerate: async () => ({ usage }) as never } as never)

    expect(result.usage.inputTokens).toEqual({ total: undefined, noCache: 300, cacheRead: 10, cacheWrite: 0 })
  })

  it('treats explicit zero raw buckets as no caching', async () => {
    const middleware = await getGatewayUsageNormalizeMiddleware()
    const usage = {
      inputTokens: 1000,
      outputTokens: 20,
      raw: { cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
    }

    const result = await middleware.wrapGenerate!({ doGenerate: async () => ({ usage }) as never } as never)

    expect(result.usage.inputTokens).toEqual({ total: 1000, noCache: 1000, cacheRead: 0, cacheWrite: 0 })
  })

  it('rewrites the nested usage of a stream finish event', async () => {
    const middleware = await getGatewayUsageNormalizeMiddleware()
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

    const parts: Array<{ usage: { inputTokens: unknown } }> = []
    for await (const part of stream as unknown as AsyncIterable<{ usage: { inputTokens: unknown } }>) parts.push(part)

    expect(parts[0]?.usage.inputTokens).toEqual({ total: 500, noCache: 100, cacheRead: 400, cacheWrite: 0 })
  })

  it('reconciles a write-only raw bucket on the stream finish event', async () => {
    const middleware = await getGatewayUsageNormalizeMiddleware()
    const chunk = {
      type: 'finish',
      finishReason: 'stop',
      usage: {
        inputTokens: { total: 1000, noCache: 1000 },
        outputTokens: { total: 20 },
        raw: { input_tokens: 920, output_tokens: 20, cache_creation_input_tokens: 80 }
      }
    }
    const { stream } = await middleware.wrapStream!({
      doStream: async () => ({ stream: new ReadableStream({ start: (c) => (c.enqueue(chunk), c.close()) }) })
    } as never)

    const parts: Array<{ usage: { inputTokens: unknown } }> = []
    for await (const part of stream as unknown as AsyncIterable<{ usage: { inputTokens: unknown } }>) parts.push(part)

    expect(parts[0]?.usage.inputTokens).toEqual({ total: 1000, noCache: 920, cacheWrite: 80 })
  })
})
