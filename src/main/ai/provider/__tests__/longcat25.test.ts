import { fileURLToPath } from 'node:url'

import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { isJSONObject } from '@ai-sdk/provider'
import { assert, describe, expect, it } from 'vitest'

import type { EndpointType } from '@cherrystudio/provider-registry'
import { RegistryLoader } from '@cherrystudio/provider-registry/node'
import { mergePresetModel, resolveReasoningProfileFromRegistry } from '@data/services/ProviderRegistryService'
import type { ReasoningEffortOption } from '@shared/types/aiSdk'

import { makeProvider } from '../../__tests__/fixtures/provider'
import { resolveNativeFileSupport } from '../../runtime/aiSdk/params/nativeFileSupport'
import { buildResolvedReasoningProviderOptions } from '../../utils/options'
import { resolveReasoningInvocation } from '../../utils/reasoningSerializers'
import { resolveAiSdkProviderId, resolveEndpointProviderOptionsKey } from '../endpoint'

const data = new URL('../../../../../packages/provider-registry/data/', import.meta.url)
const registry = new RegistryLoader({
  models: fileURLToPath(new URL('models.json', data)),
  providers: fileURLToPath(new URL('providers.json', data)),
  providerModels: fileURLToPath(new URL('provider-models.json', data))
})
const cases: [EndpointType, ReasoningEffortOption][] = [
  ['openai-chat-completions', 'none'],
  ['openai-chat-completions', 'auto'],
  ['anthropic-messages', 'none'],
  ['anthropic-messages', 'auto'],
  ['openai-responses', 'none'],
  ['openai-responses', 'auto'],
  ['openai-responses', 'minimal'],
  ['openai-responses', 'low'],
  ['openai-responses', 'medium'],
  ['openai-responses', 'high'],
  ['openai-responses', 'xhigh']
]

describe('LongCat 2.5 SDK requests', () => {
  it.each(cases)('sends %s with %s reasoning, an image and a tool', async (endpoint, selection) => {
    const provider = registry.findProvider('longcat')!
    const offer = registry.findOverride('longcat', 'LongCat-2.5')!
    const config = provider.endpointConfigs?.[endpoint]
    assert(config)
    assert(config.baseUrl)
    const profile = resolveReasoningProfileFromRegistry({
      endpointType: endpoint,
      format: config.reasoningFormat,
      contract: offer.reasoningContracts?.[endpoint]
    })
    const model = mergePresetModel(registry.findModel('LongCat-2.5')!, offer, 'longcat', profile.wire, profile.support)
    if (endpoint !== 'openai-responses') {
      expect(model.reasoning?.selectableEfforts).toEqual(['none', 'auto'])
    }
    const runtimeProvider = makeProvider({ id: 'longcat', endpointConfigs: provider.endpointConfigs })
    const aiSdkProviderId = resolveAiSdkProviderId(runtimeProvider, endpoint)
    const namespace = resolveEndpointProviderOptionsKey(runtimeProvider, {
      endpointType: endpoint,
      baseUrl: config.baseUrl
    })
    expect(
      resolveNativeFileSupport(runtimeProvider, model, {
        endpointType: endpoint,
        aiSdkProviderId,
        runtimeProviderId: aiSdkProviderId
      })
    ).toMatchObject({ image: true, video: false })
    const providerOptions = buildResolvedReasoningProviderOptions({
      aiSdkProviderId,
      providerOptionsKey: namespace,
      endpointType: endpoint,
      reasoning: resolveReasoningInvocation({ selection, model, profile: profile.wire })
    })
    const options = providerOptions[namespace] ?? {}
    assert(isJSONObject(options))
    let requestBody: Record<string, unknown> = {}
    let requestUrl = ''
    const fetch: typeof globalThis.fetch = async (input, init) => {
      requestUrl = String(input)
      requestBody = JSON.parse(String(init?.body))
      const response =
        endpoint === 'anthropic-messages'
          ? {
              id: 'msg_test',
              type: 'message',
              role: 'assistant',
              model: 'LongCat-2.5',
              content: [{ type: 'text', text: 'ok' }],
              stop_reason: 'end_turn',
              stop_sequence: null,
              usage: { input_tokens: 1, output_tokens: 1 }
            }
          : endpoint === 'openai-responses'
            ? {
                id: 'resp_test',
                object: 'response',
                created_at: 0,
                status: 'completed',
                model: 'LongCat-2.5',
                output: [
                  {
                    id: 'msg_test',
                    type: 'message',
                    role: 'assistant',
                    status: 'completed',
                    content: [{ type: 'output_text', text: 'ok', annotations: [] }]
                  }
                ],
                usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 }
              }
            : {
                id: 'chat_test',
                object: 'chat.completion',
                created: 0,
                model: 'LongCat-2.5',
                choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
                usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
              }
      return new Response(JSON.stringify(response), { headers: { 'content-type': 'application/json' } })
    }
    const settings = { apiKey: 'test', baseURL: `${config.baseUrl}/v1`, fetch }
    const sdkModel =
      endpoint === 'anthropic-messages'
        ? createAnthropic(settings)('LongCat-2.5')
        : endpoint === 'openai-responses'
          ? createOpenAI(settings).responses('LongCat-2.5')
          : createOpenAICompatible({ ...settings, name: namespace })('LongCat-2.5')
    await sdkModel.doGenerate({
      prompt: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Describe the image' },
            { type: 'file', mediaType: 'image/png', data: new Uint8Array([1, 2, 3]) }
          ]
        }
      ],
      tools: [{ type: 'function', name: 'get_weather', inputSchema: { type: 'object', properties: {} } }],
      maxOutputTokens: 128,
      providerOptions: { [namespace]: options }
    })
    expect(requestBody.model).toBe('LongCat-2.5')
    if (endpoint === 'openai-responses') {
      expect(requestUrl).toBe('https://api.longcat.chat/openai/v1/responses')
      expect(requestBody).toMatchObject({
        reasoning: { effort: selection === 'auto' ? 'medium' : selection },
        input: [
          { content: expect.arrayContaining([{ type: 'input_image', image_url: 'data:image/png;base64,AQID' }]) }
        ],
        tools: [{ name: 'get_weather' }]
      })
    } else if (endpoint === 'anthropic-messages') {
      expect(requestUrl).toBe('https://api.longcat.chat/anthropic/v1/messages')
      expect(requestBody.thinking).toMatchObject({ type: selection === 'none' ? 'disabled' : 'enabled' })
      expect(requestBody).toMatchObject({
        messages: [
          {
            content: expect.arrayContaining([
              { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AQID' } }
            ])
          }
        ],
        tools: [{ name: 'get_weather' }]
      })
    } else {
      expect(requestUrl).toBe('https://api.longcat.chat/openai/v1/chat/completions')
      expect(requestBody.thinking).toEqual({ type: selection === 'none' ? 'disabled' : 'enabled' })
      expect(requestBody).toMatchObject({
        messages: [
          { content: expect.arrayContaining([{ type: 'image_url', image_url: { url: 'data:image/png;base64,AQID' } }]) }
        ],
        tools: [{ function: { name: 'get_weather' } }]
      })
    }
  })
})
