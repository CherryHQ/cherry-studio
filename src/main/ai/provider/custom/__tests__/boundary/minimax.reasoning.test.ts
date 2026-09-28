import path from 'node:path'

import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModelV3CallOptions } from '@ai-sdk/provider'
import { describe, expect, it } from 'vitest'
import * as z from 'zod'

import { REASONING_FORMAT_PROFILES } from '@cherrystudio/provider-registry'
import { RegistryLoader } from '@cherrystudio/provider-registry/node'
import { deriveThinkingOptions } from '@shared/ai/reasoning'
import type { ReasoningEffortOption } from '@shared/types/aiSdk'

import { makeModel } from '../../../../__tests__/fixtures'
import { encodeReasoningInvocation, resolveReasoningInvocation } from '../../../../utils/reasoningSerializers'
import { captureWithFetch } from './captureRequest'

const dataDir = path.resolve('packages/provider-registry/data')
const loader = new RegistryLoader({
  models: path.join(dataDir, 'models.json'),
  providers: path.join(dataDir, 'providers.json'),
  providerModels: path.join(dataDir, 'provider-models.json')
})
const apiModelId = 'MiniMax-M3.1-Flash-Preview'
const preset = loader.findModel(apiModelId)!
const model = makeModel({
  apiModelId,
  capabilities: preset.capabilities,
  reasoning: { ...preset.reasoning, selectableEfforts: preset.reasoning?.supportedEfforts ?? [] }
})
const prompt: LanguageModelV3CallOptions['prompt'] = [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }]
const selections: ReasoningEffortOption[] = ['default', 'none', 'low', 'medium', 'high', 'xhigh', 'max']
const optionsSchema = z.record(z.string(), z.json())

describe('MiniMax M3.1 reasoning request boundary', () => {
  it('offers five tiers plus server default to the shared chat and Agent control', () => {
    expect(deriveThinkingOptions(model)).toEqual(['default', 'low', 'medium', 'high', 'xhigh', 'max'])
  })

  describe.each(['minimax', 'minimax-global'])('%s', (providerId) => {
    it.each(selections)('serializes OpenAI effort %s without disabling thinking', async (selection) => {
      const profile = REASONING_FORMAT_PROFILES['openai-chat'].wire
      const options = optionsSchema.parse(
        encodeReasoningInvocation(resolveReasoningInvocation({ selection, model, profile }))
      )
      const request = await captureWithFetch((fetch) =>
        createOpenAICompatible({ name: providerId, baseURL: 'https://example.com/v1', apiKey: 'test', fetch })
          .languageModel(apiModelId)
          .doGenerate({ prompt, providerOptions: { [providerId]: options } })
      )
      if (selection === 'default' || selection === 'none') {
        expect(request.body).not.toHaveProperty('reasoning_effort')
      } else {
        expect(request.body).toMatchObject({ model: apiModelId, reasoning_effort: selection })
      }
      expect(request.body).not.toHaveProperty('thinking')
    })

    it.each(selections)('serializes Anthropic effort %s without disabling thinking', async (selection) => {
      const profile = loader.findOverride(providerId, apiModelId)!.reasoningContracts!['anthropic-messages']!.wire!
      const options = optionsSchema.parse(
        encodeReasoningInvocation(resolveReasoningInvocation({ selection, model, profile }))
      )
      const request = await captureWithFetch((fetch) =>
        createAnthropic({ baseURL: 'https://example.com/anthropic/v1', apiKey: 'test', fetch })
          .languageModel(apiModelId)
          .doGenerate({ prompt, maxOutputTokens: 4096, providerOptions: { anthropic: options } })
      )
      if (selection === 'default' || selection === 'none') {
        expect(request.body).not.toHaveProperty('output_config')
      } else {
        expect(request.body).toMatchObject({ model: apiModelId, output_config: { effort: selection } })
      }
      expect(request.body).not.toHaveProperty('thinking')
    })
  })
})
