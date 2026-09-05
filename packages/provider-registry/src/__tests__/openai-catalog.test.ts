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
        output: { currency: 'USD', perMillionTokens: 50 }
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

  it('enables OpenAI web search for GPT-6 Astra', () => {
    expect(isServerToolModelEligible('gpt-6-astra', 'openai', 'web-search')).toBe(true)
  })
})
