import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { CREATORS } from '../creators'
import { RegistryLoader } from '../registry-loader'

const dataDir = join(fileURLToPath(import.meta.url), '..', '..', '..', 'data')
const loader = new RegistryLoader({
  models: join(dataDir, 'models.json'),
  providers: join(dataDir, 'providers.json'),
  providerModels: join(dataDir, 'provider-models.json')
})

describe('Alibaba Qwen catalog', () => {
  it('hand-lists Qwen3.8 Flash with its documented capabilities and token limits', () => {
    const alibaba = CREATORS.find(({ id }) => id === 'alibaba')

    expect(alibaba?.models?.find(({ id }) => id === 'qwen3-8-flash')).toMatchObject({
      capabilities: expect.arrayContaining([
        'reasoning',
        'function-call',
        'image-recognition',
        'video-recognition',
        'structured-output'
      ]),
      contextWindow: 1000000,
      maxInputTokens: 991808,
      maxOutputTokens: 131072,
      name: 'Qwen3.8 Flash'
    })
    expect(loader.findModel('qwen3-8-flash')).toMatchObject({
      id: 'qwen3-8-flash',
      name: 'Qwen3.8 Flash',
      ownedBy: 'alibaba'
    })
  })

  it('maps DashScope to qwen3.8-flash with the Qwen3.8 effort contract', () => {
    expect(loader.findOverride('dashscope', 'qwen3.8-flash')).toMatchObject({
      apiModelId: 'qwen3.8-flash',
      endpointTypes: ['openai-responses', 'openai-chat-completions'],
      modelId: 'qwen3-8-flash',
      reasoningContracts: {
        'openai-chat-completions': {
          support: {
            controls: [{ default: 'xhigh', kind: 'effort', values: ['none', 'low', 'medium', 'xhigh'] }],
            thinkingTokenLimits: { min: 0, max: 262144 }
          }
        },
        'openai-responses': {
          support: {
            controls: [
              { default: 'xhigh', kind: 'effort', values: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] }
            ]
          }
        }
      }
    })
  })

  it('maps QwenCloud to qwen3.8-flash with the Qwen3.8 chat effort contract', () => {
    const override = loader.findOverride('qwencloud', 'qwen3.8-flash')
    expect(override).toMatchObject({
      apiModelId: 'qwen3.8-flash',
      modelId: 'qwen3-8-flash',
      name: 'Qwen3.8 Flash',
      reasoningContracts: {
        'openai-chat-completions': {
          support: {
            controls: [{ default: 'xhigh', kind: 'effort', values: ['none', 'low', 'medium', 'xhigh'] }],
            thinkingTokenLimits: { min: 0, max: 262144 }
          }
        }
      }
    })
    // No per-model Responses support list is published internationally, so the
    // contract mirrors qwen3.8-max's Chat-only shape, not DashScope's dual-endpoint one.
    expect(override?.reasoningContracts).not.toHaveProperty('openai-responses')
  })
})
