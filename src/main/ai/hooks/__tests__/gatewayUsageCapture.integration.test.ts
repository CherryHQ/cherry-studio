import type { LanguageModelV3StreamPart, LanguageModelV3Usage } from '@ai-sdk/provider'
import { wrapLanguageModel } from 'ai'
import type { LanguageModelMiddleware } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AiPlugin, AiRequestContext } from '@cherrystudio/ai-core'
import { PluginManager } from '@cherrystudio/ai-core/core/plugins/manager'
import { collectFromFeatures } from '@main/ai/runtime/aiSdk/params/collectFromFeatures'
import {
  gatewayAnthropicCacheFeature,
  gatewayUsageNormalizeFeature
} from '@main/ai/runtime/aiSdk/params/features/gatewayUsageNormalize'
import type { RequestScope } from '@main/ai/runtime/aiSdk/params/scope'
import type { Provider } from '@shared/data/types/provider'

const recordInvocation = vi.fn()

vi.mock('@main/data/services/AiUsageRecordService', () => ({
  aiUsageRecordService: { recordInvocation }
}))

const { createAiUsagePlugin } = await import('../billingHook')

const captureContext = {
  providerId: 'gateway',
  providerName: 'Vercel AI Gateway',
  modelId: 'anthropic/claude-sonnet',
  modelName: 'Claude Sonnet',
  pricingSnapshot: null,
  trustProviderReportedCost: false,
  reportedCostCurrency: null,
  credentialReceipt: { attribution: 'unknown' as const },
  source: null,
  messageRef: { kind: 'chat' as const, id: 'message-1' }
}

// Genuine Anthropic semantics: raw input_tokens is the uncached count; the gateway's flat
// inputTokens is the prompt total inclusive of the cache buckets.
const FLAT_GATEWAY_USAGE = {
  inputTokens: 1000,
  outputTokens: 20,
  cachedInputTokens: 900,
  raw: { input_tokens: 20, output_tokens: 20, cache_read_input_tokens: 900, cache_creation_input_tokens: 80 }
}

const EXPECTED_CAPTURED_USAGE = {
  inputTokens: 1000,
  outputTokens: 20,
  noCacheTokens: 20,
  cacheReadTokens: 900,
  cacheWriteTokens: 80
}

function makeScope(): RequestScope {
  const provider = { id: 'gateway', presetProviderId: 'gateway', settings: {} } as Provider
  return {
    provider,
    model: {},
    endpointType: 'openai-chat-completions',
    aiSdkProviderId: 'gateway'
  } as unknown as RequestScope
}

// Mirrors AiService: feature model adapters in registration order, the usage-capture plugin last,
// all sorted by the PluginManager and applied through the AI SDK's wrapLanguageModel.
async function buildWrappedModel(model: { doGenerate?: () => Promise<unknown>; doStream?: () => Promise<unknown> }) {
  const adapters: AiPlugin[] = collectFromFeatures(makeScope(), [
    gatewayUsageNormalizeFeature,
    gatewayAnthropicCacheFeature
  ]).modelAdapters
  const plugins = [...adapters, createAiUsagePlugin(captureContext)]
  const manager = new PluginManager(plugins)
  const context = { middlewares: [] as LanguageModelMiddleware[] } as unknown as AiRequestContext
  await manager.executeConfigureContext(context)
  return wrapLanguageModel({ model: model as never, middleware: context.middlewares as never })
}

describe('usage capture at the billing point sees reconciled cache buckets', () => {
  beforeEach(() => {
    recordInvocation.mockClear()
  })

  it('records reconciled buckets for a non-streaming call', async () => {
    const wrapped = await buildWrappedModel({
      doGenerate: async () => ({ usage: FLAT_GATEWAY_USAGE, finishReason: 'stop', content: [] })
    })

    await wrapped.doGenerate({ prompt: [] })

    expect(recordInvocation).toHaveBeenCalledTimes(1)
    expect(recordInvocation.mock.calls[0]?.[0].usage).toMatchObject(EXPECTED_CAPTURED_USAGE)
  })

  it('records reconciled buckets for a streaming call', async () => {
    const finish: LanguageModelV3StreamPart = {
      type: 'finish',
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: FLAT_GATEWAY_USAGE as unknown as LanguageModelV3Usage
    }
    const wrapped = await buildWrappedModel({
      doStream: async () => ({
        stream: new ReadableStream<LanguageModelV3StreamPart>({
          start: (c) => (c.enqueue(finish), c.close())
        })
      })
    })

    const { stream } = await wrapped.doStream({ prompt: [] })
    for await (const _ of stream as unknown as AsyncIterable<unknown>) void _

    expect(recordInvocation).toHaveBeenCalledTimes(1)
    expect(recordInvocation.mock.calls[0]?.[0].usage).toMatchObject(EXPECTED_CAPTURED_USAGE)
  })
})
