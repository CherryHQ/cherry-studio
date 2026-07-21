import type { Assistant } from '@shared/data/types/assistant'
import { createUniqueModelId, ENDPOINT_TYPE, type Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { describe, expect, it } from 'vitest'

import { getReasoningEffort, getXAIReasoningParams } from '../reasoning'

describe('getXAIReasoningParams', () => {
  const grok43Model = {
    id: createUniqueModelId('xai', 'grok-4.3'),
    providerId: 'xai',
    apiModelId: 'grok-4.3',
    name: 'grok-4.3'
  } as unknown as Model

  it('sends none for Grok 4.3 (reasoning disabled — the xAI enum supports it, added by #15137)', () => {
    const assistant = {
      settings: {
        reasoning_effort: 'none'
      }
    } as Assistant

    expect(getXAIReasoningParams(assistant, grok43Model)).toEqual({ reasoningEffort: 'none' })
  })

  it('keeps supported Grok 4.3 reasoning efforts', () => {
    const assistant = {
      settings: {
        reasoning_effort: 'high'
      }
    } as Assistant

    expect(getXAIReasoningParams(assistant, grok43Model)).toEqual({ reasoningEffort: 'high' })
  })
})

describe('getReasoningEffort', () => {
  it('uses the model endpoint when detecting self-hosted reasoning format', () => {
    const assistant = {
      settings: {
        reasoning_effort: 'none'
      }
    } as Assistant

    const model = {
      id: createUniqueModelId('relay', 'qwen3-32b'),
      providerId: 'relay',
      apiModelId: 'qwen3-32b',
      name: 'Qwen 3 32B',
      capabilities: [],
      endpointTypes: [ENDPOINT_TYPE.OPENAI_RESPONSES],
      reasoning: {
        type: 'qwen',
        thinkingTokenLimits: {
          min: 1024,
          max: 8192
        },
        supportedEfforts: ['none', 'low', 'medium', 'high']
      }
    } as unknown as Model

    const provider = {
      id: 'relay',
      name: 'Relay',
      apiKeys: [],
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: {
          reasoningFormatType: 'enable-thinking'
        },
        [ENDPOINT_TYPE.OPENAI_RESPONSES]: {
          reasoningFormatType: 'self-hosted'
        }
      }
    } as unknown as Provider

    expect(getReasoningEffort(assistant, model, provider)).toEqual({
      chat_template_kwargs: {
        enable_thinking: false
      }
    })
  })

  it('routes self-hosted Hunyuan enablement through chat_template_kwargs', () => {
    const assistant = {
      settings: {
        reasoning_effort: 'high'
      }
    } as Assistant

    const model = {
      id: createUniqueModelId('relay', 'hunyuan-t1'),
      providerId: 'relay',
      apiModelId: 'hunyuan-t1',
      name: 'Hunyuan T1',
      capabilities: [],
      reasoning: {
        type: 'hunyuan',
        thinkingTokenLimits: {
          min: 1024,
          max: 8192
        },
        supportedEfforts: ['none', 'low', 'medium', 'high']
      }
    } as unknown as Model

    const provider = {
      id: 'relay',
      name: 'Relay',
      apiKeys: [],
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: {
          reasoningFormatType: 'self-hosted'
        }
      }
    } as unknown as Provider

    expect(getReasoningEffort(assistant, model, provider)).toEqual({
      chat_template_kwargs: {
        enable_thinking: true
      }
    })
  })
})
