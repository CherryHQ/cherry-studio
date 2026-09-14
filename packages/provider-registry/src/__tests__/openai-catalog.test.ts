import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { isServerToolModelEligible } from '../patterns/serverToolModelEligibility'
import { RegistryLoader } from '../registry-loader'

const dataDir = join(fileURLToPath(import.meta.url), '..', '..', '..', 'data')
const loader = new RegistryLoader({
  models: join(dataDir, 'models.json'),
  providers: join(dataDir, 'providers.json'),
  providerModels: join(dataDir, 'provider-models.json')
})

describe('OpenAI catalog', () => {
  it('catalogs GPT-6 Astra with its documented capabilities, limits, and reasoning controls', () => {
    expect(loader.findModel('gpt-6-astra')).toMatchObject({
      id: 'gpt-6-astra',
      name: 'GPT-6 Astra',
      ownedBy: 'openai',
      capabilities: expect.arrayContaining([
        'reasoning',
        'function-call',
        'image-recognition',
        'structured-output',
        'file-search'
      ]),
      inputModalities: ['text', 'image'],
      outputModalities: ['text'],
      contextWindow: 1050000,
      maxInputTokens: 922000,
      maxOutputTokens: 128000,
      pricing: {
        input: { currency: 'USD', perMillionTokens: 10 },
        cacheRead: { currency: 'USD', perMillionTokens: 1 },
        cacheWrite: { currency: 'USD', perMillionTokens: 12.5 },
        output: { currency: 'USD', perMillionTokens: 50 },
        inputTokenTiers: [
          {
            minInputTokens: 272001,
            input: { currency: 'USD', perMillionTokens: 20 },
            cacheRead: { currency: 'USD', perMillionTokens: 2 },
            cacheWrite: { currency: 'USD', perMillionTokens: 25 },
            output: { currency: 'USD', perMillionTokens: 75 }
          }
        ]
      },
      parameterSupport: {
        frequencyPenalty: false,
        maxTokens: true,
        presencePenalty: false,
        stopSequences: false,
        systemMessage: true,
        temperature: { supported: false },
        topK: { supported: false },
        topP: { supported: false }
      },
      reasoning: {
        controls: [{ kind: 'effort', values: ['low', 'medium', 'high', 'xhigh', 'max'] }]
      }
    })
  })

  it('keeps GPT-6 Astra on the OpenAI Responses endpoint', () => {
    expect(loader.findProvider('openai')).toMatchObject({
      defaultChatEndpoint: 'openai-responses',
      endpointConfigs: {
        'openai-responses': { adapterFamily: 'openai' }
      }
    })
    expect(loader.findOverride('openai', 'gpt-6-astra')).toBeNull()
  })

  it('offers GPT-6 Astra through ChatGPT Codex with its subscription limits and controls', () => {
    expect(loader.findOverride('openai-codex', 'gpt-6-astra')).toMatchObject({
      apiModelId: 'gpt-6-astra',
      endpointTypes: ['openai-responses'],
      limits: { contextWindow: 272000, maxInputTokens: 144000 },
      modelId: 'gpt-6-astra',
      providerId: 'openai-codex',
      reasoningContracts: {
        'openai-responses': {
          support: {
            controls: [
              {
                default: 'low',
                kind: 'effort',
                values: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra']
              }
            ],
            defaultEffort: 'low'
          }
        }
      },
      supportsFastMode: true
    })
  })

  // The base catalog infers the platform-API ladder for gpt-5.6 (`none`…`xhigh`), which the Codex
  // backend neither accepts (`none`) nor is limited to (`max`/`ultra`); each SKU carries its own.
  it.each([
    ['gpt-5-6-sol', ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'], 'low'],
    ['gpt-5-6-terra', ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'], 'medium'],
    ['gpt-5-6-luna', ['low', 'medium', 'high', 'xhigh', 'max'], 'medium'],
    ['gpt-5-5', ['low', 'medium', 'high', 'xhigh'], 'medium']
  ])('serves %s on Codex with the backend ladder, not the platform one', (modelId, values, defaultEffort) => {
    const contract = loader.findOverride('openai-codex', modelId)?.reasoningContracts?.['openai-responses']

    expect(contract?.support?.controls).toEqual([{ default: defaultEffort, kind: 'effort', values }])
    expect(contract?.support?.defaultEffort).toBe(defaultEffort)
  })

  it('enables OpenAI web search for GPT-6 Astra', () => {
    expect(isServerToolModelEligible('gpt-6-astra', 'openai', 'web-search')).toBe(true)
  })
})
