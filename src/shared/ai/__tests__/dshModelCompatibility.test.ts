import type { Model } from '@shared/data/types/model'
import { ENDPOINT_TYPE } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { describe, expect, it } from 'vitest'

import { resolveDshApi, resolveDshEndpointType } from '../dshModelCompatibility'

const model = {
  id: 'dual::model',
  providerId: 'dual',
  name: 'Dual model',
  capabilities: [],
  supportsStreaming: true,
  isEnabled: true,
  isHidden: false,
  endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS, ENDPOINT_TYPE.ANTHROPIC_MESSAGES],
  contextWindow: 128_000
} as Model

describe('dsh endpoint selection', () => {
  it('uses the configured Anthropic route for a dual-protocol model in both filtering and injection', () => {
    const provider = {
      id: 'dual',
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { adapterFamily: 'openai', baseUrl: 'https://openai.example' },
        [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { adapterFamily: 'anthropic', baseUrl: 'https://anthropic.example' }
      }
    } as Provider

    expect(resolveDshEndpointType(provider, model)).toBe(ENDPOINT_TYPE.ANTHROPIC_MESSAGES)
    expect(resolveDshApi(provider, model)).toBe('anthropic-messages')
  })

  it('falls back to the model default when the preferred Anthropic route is not configured', () => {
    const provider = {
      id: 'dual',
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { adapterFamily: 'openai', baseUrl: 'https://openai.example' },
        [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { adapterFamily: 'anthropic' }
      }
    } as Provider

    expect(resolveDshEndpointType(provider, model)).toBe(ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS)
    expect(resolveDshApi(provider, model)).toBe('openai-completions')
  })

  it('admits Google Generate Content through the pi-ai catalog route', () => {
    const provider = {
      id: 'gemini',
      defaultChatEndpoint: ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT,
      endpointConfigs: {
        [ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT]: {
          adapterFamily: 'google',
          baseUrl: 'https://generativelanguage.googleapis.com'
        }
      }
    } as Provider

    expect(resolveDshApi(provider, { ...model, endpointTypes: [ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT] })).toBe(
      'google-generative-ai'
    )
  })

  it.each(['aihubmix', 'dmxapi'])('routes %s Gemini models through Google without model endpoint metadata', (id) => {
    const provider = {
      id,
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { adapterFamily: id, baseUrl: `https://${id}.example/v1` },
        [ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT]: { adapterFamily: id, baseUrl: `https://${id}.example/v1beta` }
      }
    } as Provider
    const gatewayModel = {
      ...model,
      id: `${id}::gemini-2.5-pro`,
      providerId: id,
      apiModelId: 'gemini-2.5-pro',
      endpointTypes: undefined
    }

    expect(resolveDshEndpointType(provider, gatewayModel)).toBe(ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT)
    expect(resolveDshApi(provider, gatewayModel)).toBe('google-generative-ai')
  })
})
