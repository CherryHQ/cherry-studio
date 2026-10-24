import { resolve } from 'node:path'

import type { LanguageModelV3CallOptions } from '@ai-sdk/provider'
import { setupTestDatabase } from '@test-helpers/db'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { modelService } from '@data/services/ModelService'
import { providerRegistryService } from '@data/services/ProviderRegistryService'
import { providerService } from '@data/services/ProviderService'
import { captureWithFetch } from '@main/ai/provider/custom/__tests__/boundary/captureRequest'
import { createOllamaWithImageModel } from '@main/ai/provider/custom/ollama/ollamaProvider'
import { listModels } from '@main/ai/provider/listModels'
import * as customFetchModule from '@main/ai/utils/customFetch'
import type { EndpointType } from '@shared/data/types/model'

import { buildAgentParams } from '../buildAgentParams'

const MODEL_ID = 'nemotron-3.5-lightning:30b-a3b'
const PROMPT: LanguageModelV3CallOptions['prompt'] = [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }]

describe('Ollama discovered reasoning through request construction', () => {
  setupTestDatabase()

  beforeEach(() => {
    const getPath = vi.mocked(application.getPath).getMockImplementation()
    vi.spyOn(application, 'getPath').mockImplementation((key, filename) =>
      key === 'feature.provider_registry.data' && filename
        ? resolve(process.cwd(), 'packages/provider-registry/data', filename)
        : key === 'app.root'
          ? resolve(process.cwd(), filename ?? '')
          : (getPath?.(key, filename) ?? `/mock/${key}`)
    )
    providerRegistryService.clearCache()
    vi.spyOn(customFetchModule, 'customFetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/api/tags')) return Response.json({ models: [{ name: MODEL_ID }] })
      if (url.endsWith('/api/show')) {
        return Response.json({
          capabilities: ['thinking'],
          thinking: { values: [false, true, 'medium'], default: true }
        })
      }
      throw new Error(`Unexpected discovery URL: ${url}`)
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    providerRegistryService.clearCache()
  })

  describe.each(['doGenerate', 'doStream'] as const)('%s with a saved non-native endpoint', (method) => {
    it.each<{ endpointTypes: EndpointType[] }>([
      { endpointTypes: ['anthropic-messages'] },
      { endpointTypes: ['anthropic-messages', 'ollama-chat'] }
    ])('projects reasoning through the first saved endpoint: $endpointTypes', async ({ endpointTypes }) => {
      const provider = providerService.create({
        providerId: 'ollama',
        presetProviderId: 'ollama',
        name: 'Ollama',
        endpointConfigs: { 'ollama-chat': { baseUrl: 'https://ollama.example' } }
      })
      const { models } = await listModels(provider)
      modelService.create([
        {
          dto: {
            providerId: provider.id,
            modelId: MODEL_ID,
            endpointTypes,
            capabilities: models[0].capabilities,
            reasoning: models[0].reasoning
          },
          registryData: providerRegistryService.lookupModel(provider.id, MODEL_ID)
        }
      ])
      const nonNative = modelService.getByKey(provider.id, MODEL_ID)
      expect(nonNative.endpointTypes).toEqual(endpointTypes)
      expect(nonNative.reasoning?.selectableEfforts).toEqual(['none', 'auto'])
      expect(modelService.list({ providerId: provider.id })[0].reasoning?.selectableEfforts).toEqual(['none', 'auto'])

      for (const [model, expected] of [
        [nonNative, undefined],
        [modelService.update(provider.id, MODEL_ID, { endpointTypes: ['ollama-chat', 'anthropic-messages'] }), 'medium']
      ] as const) {
        const params = await buildAgentParams({
          provider,
          model,
          request: { conversation: { id: 'ollama-test' }, disableTools: true, reasoningEffort: 'medium' },
          signal: undefined
        })
        const request = await captureWithFetch((fetch) =>
          createOllamaWithImageModel({ baseURL: 'https://ollama.example/api', fetch })
            .languageModel(params.sdkConfig.modelId)
            [method]({ prompt: PROMPT, providerOptions: params.options.providerOptions })
        )

        if (expected === undefined) expect(request.body).not.toHaveProperty('think')
        else {
          expect(model.reasoning?.selectableEfforts).toEqual(['none', 'auto', 'medium'])
          expect(request.body).toHaveProperty('think', expected)
        }
      }
    })
  })

  describe.each(['doGenerate', 'doStream'] as const)('%s', (method) => {
    it.each([
      ['default', undefined],
      ['none', false],
      ['auto', true],
      ['medium', 'medium']
    ] as const)('sends the discovered %s selection despite catalog toggle controls', async (selection, expected) => {
      const provider = providerService.create({
        providerId: 'ollama',
        presetProviderId: 'ollama',
        name: 'Ollama',
        endpointConfigs: { 'ollama-chat': { baseUrl: 'https://ollama.example' } }
      })
      const { models } = await listModels(provider)
      const discovered = models[0]
      expect(discovered.reasoning?.selectableEfforts).toEqual(['none', 'auto', 'medium'])
      modelService.create([
        {
          dto: {
            providerId: provider.id,
            modelId: MODEL_ID,
            name: 'Local Nemotron',
            capabilities: discovered.capabilities,
            endpointTypes: discovered.endpointTypes,
            reasoning: discovered.reasoning
          },
          registryData: providerRegistryService.lookupModel(provider.id, MODEL_ID)
        }
      ])
      const model = modelService.getByKey(provider.id, MODEL_ID)
      expect(model.presetModelId).toBe('nemotron-3-5-lightning-30b-a3b')
      expect(model.reasoning?.selectableEfforts).toEqual(['none', 'auto', 'medium'])

      const params = await buildAgentParams({
        provider,
        model,
        request: { conversation: { id: 'ollama-test' }, disableTools: true, reasoningEffort: selection },
        signal: undefined
      })
      const request = await captureWithFetch((fetch) =>
        createOllamaWithImageModel({ baseURL: 'https://ollama.example/api', fetch })
          .languageModel(params.sdkConfig.modelId)
          [method]({ prompt: PROMPT, providerOptions: params.options.providerOptions })
      )

      expect(request.url).toBe('https://ollama.example/api/chat')
      expect(request.body).toMatchObject({ model: MODEL_ID, stream: method === 'doStream' })
      if (expected === undefined) expect(request.body).not.toHaveProperty('think')
      else expect(request.body).toHaveProperty('think', expected)
    })
  })
})
