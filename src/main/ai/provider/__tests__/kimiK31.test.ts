import { fileURLToPath } from 'node:url'

import { createAnthropic } from '@ai-sdk/anthropic'
import { isJSONObject, type LanguageModelV3CallOptions } from '@ai-sdk/provider'
import { assert, describe, expect, it } from 'vitest'

import { inferReasoningControls, type EndpointType } from '@cherrystudio/provider-registry'
import { RegistryLoader } from '@cherrystudio/provider-registry/node'
import { mergePresetModel, resolveReasoningProfileFromRegistry } from '@data/services/ProviderRegistryService'
import type { ReasoningEffortOption } from '@shared/types/aiSdk'
import { computeLanguageCost, createAiUsagePricingSnapshot } from '@shared/utils/usagePricing'

import { encodeReasoningInvocation, resolveReasoningInvocation } from '../../utils/reasoningSerializers'
import { createMoonshotProvider } from '../custom/moonshotProvider'

const data = new URL('../../../../../packages/provider-registry/data/', import.meta.url)
const registry = new RegistryLoader({
  models: fileURLToPath(new URL('models.json', data)),
  providers: fileURLToPath(new URL('providers.json', data)),
  providerModels: fileURLToPath(new URL('provider-models.json', data))
})
const modelIds = ['kimi-k3.1-pro', 'kimi-k3.1-pro-highspeed']
const providerIds = ['moonshot', 'moonshot-global']
const endpoints: EndpointType[] = ['openai-chat-completions', 'anthropic-messages']
const prompt: LanguageModelV3CallOptions['prompt'] = [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }]

function resolveModel(providerId: string, modelId: string, endpointType: EndpointType) {
  const preset = registry.findModel(modelId)!
  const override = registry.findOverride(providerId, modelId)!
  const provider = registry.findProvider(providerId)!
  expect(override.apiModelId).toBe(modelId)
  const profile = resolveReasoningProfileFromRegistry({
    endpointType,
    format: provider.endpointConfigs?.[endpointType]?.reasoningFormat,
    contract: override.reasoningContracts?.[endpointType]
  })
  return { model: mergePresetModel(preset, override, providerId, profile.wire, profile.support), profile: profile.wire }
}

describe.each(modelIds)('Kimi K3.1 catalog: %s', (modelId) => {
  it('exposes documented limits, multimodal tools and always-on three-tier reasoning', () => {
    expect(registry.findModel(modelId)).toMatchObject({
      contextWindow: 1_048_576,
      maxOutputTokens: 1_048_576,
      inputModalities: ['text', 'image', 'video'],
      capabilities: expect.arrayContaining([
        'function-call',
        'reasoning',
        'image-recognition',
        'video-recognition',
        'structured-output'
      ])
    })
    expect(inferReasoningControls(modelId)).toEqual([{ kind: 'effort', values: ['low', 'high', 'max'] }])
  })

  describe.each(providerIds)('%s', (providerId) => {
    it.each(endpoints)('projects supported settings for %s without an off switch', (endpoint) => {
      const { model } = resolveModel(providerId, modelId, endpoint)
      expect(model.reasoning?.selectableEfforts).toEqual(['low', 'high', 'max'])
      expect(model.reasoning?.defaultEffort).toBe('max')
      expect(model.parameterSupport).toMatchObject({
        temperature: { supported: false },
        topP: { supported: false },
        presencePenalty: false,
        frequencyPenalty: false
      })
    })

    describe.each(endpoints)('%s request', (endpoint) => {
      it.each<ReasoningEffortOption>(['low', 'high', 'max', 'auto', 'default', 'none'])(
        'serializes %s through the installed SDK without K2 thinking fields',
        async (selection) => {
          const { model, profile } = resolveModel(providerId, modelId, endpoint)
          const invocation = resolveReasoningInvocation({ selection, model, profile })
          const options = encodeReasoningInvocation(invocation)
          assert(isJSONObject(options))
          let body: Record<string, unknown> = {}
          const fetch: typeof globalThis.fetch = async (_input, init) => {
            body = JSON.parse(String(init?.body))
            const response =
              endpoint === 'anthropic-messages'
                ? {
                    id: 'msg_1',
                    type: 'message',
                    role: 'assistant',
                    model: modelId,
                    content: [{ type: 'text', text: 'Hello' }],
                    stop_reason: 'end_turn',
                    stop_sequence: null,
                    usage: { input_tokens: 1, output_tokens: 1 }
                  }
                : {
                    id: 'chat_1',
                    object: 'chat.completion',
                    created: 0,
                    model: modelId,
                    choices: [{ index: 0, message: { role: 'assistant', content: 'Hello' }, finish_reason: 'stop' }],
                    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
                  }
            return new Response(JSON.stringify(response), { headers: { 'content-type': 'application/json' } })
          }
          const sdkModel =
            endpoint === 'anthropic-messages'
              ? createAnthropic({ apiKey: 'test', baseURL: 'https://example.test/anthropic/v1', fetch })(modelId)
              : createMoonshotProvider({ apiKey: 'test', baseURL: 'https://example.test/v1', fetch })(modelId)
          await sdkModel.doGenerate({
            prompt,
            maxOutputTokens: 128,
            providerOptions: { [endpoint === 'anthropic-messages' ? 'anthropic' : 'moonshot']: options }
          })
          const expected =
            selection === 'auto' ? 'max' : ['default', 'none'].includes(selection) ? undefined : selection
          expect(body.model).toBe(modelId)
          expect(body.thinking).toBeUndefined()
          if (endpoint === 'anthropic-messages') {
            expect(body.output_config).toEqual(expected ? { effort: expected } : undefined)
          } else {
            expect(body.reasoning_effort).toBe(expected)
          }
        }
      )
    })
  })
})

describe('Kimi K3.1 provider billing', () => {
  it.each([
    ['moonshot', 'kimi-k3.1-pro', 'CNY', 75.15],
    ['moonshot', 'kimi-k3.1-pro-highspeed', 'CNY', 149.65],
    ['moonshot-global', 'kimi-k3.1-pro', 'USD', 11.1],
    ['moonshot-global', 'kimi-k3.1-pro-highspeed', 'USD', 22.1]
  ] as const)('prices cached input and output for %s/%s in %s', (providerId, modelId, currency, cost) => {
    const { model } = resolveModel(providerId, modelId, 'openai-chat-completions')
    const snapshot = createAiUsagePricingSnapshot(model.pricing)
    assert(snapshot)
    expect(snapshot?.currency).toBe(currency)
    expect(
      computeLanguageCost(
        { inputTokens: 1_000_000, outputTokens: 1_000_000, inputTokenDetails: { cacheReadTokens: 500_000 } },
        snapshot
      )?.cost
    ).toBeCloseTo(cost)
  })
})
