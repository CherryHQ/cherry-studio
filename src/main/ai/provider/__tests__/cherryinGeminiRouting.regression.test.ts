import { resolveGatewayChatRoute } from '@shared/data/presets/gatewayChatRouting'
import { ENDPOINT_TYPE } from '@shared/data/types/model'
import { describe, expect, it } from 'vitest'

import { makeModel, makeProvider } from '../../__tests__/fixtures'
import { resolveEffectiveEndpoint } from '../endpoint'

describe('REGRESSION: cherryin gemini routing for built-in tools + function calling', () => {
  const cherryin = makeProvider({
    id: 'cherryin',
    defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
    endpointConfigs: {
      [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://open.cherryin.net', adapterFamily: 'cherryin' },
      [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { baseUrl: 'https://open.cherryin.net', adapterFamily: 'cherryin' },
      [ENDPOINT_TYPE.OPENAI_RESPONSES]: { baseUrl: 'https://open.cherryin.net', adapterFamily: 'cherryin' },
      [ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT]: { baseUrl: 'https://open.cherryin.net', adapterFamily: 'cherryin' }
    }
  })

  it('gateway route resolves gemini-3.5-flash to google endpoint', () => {
    const model = makeModel({
      id: 'cherryin::gemini-3.5-flash',
      providerId: 'cherryin',
      apiModelId: 'gemini-3.5-flash'
    })
    const route = resolveGatewayChatRoute(cherryin as any, model as any)
    expect(route).toEqual({ endpointType: ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT, providerOptionsKey: 'google' })
  })

  it('effective endpoint for cherryin gemini without endpointTypes is google, not openai-chat', () => {
    const model: any = makeModel({
      id: 'cherryin::gemini-3.5-flash',
      providerId: 'cherryin',
      apiModelId: 'gemini-3.5-flash'
    })
    // intentionally no endpointTypes to mimic cherryin.listModels missing supported_endpoint_types
    delete model.endpointTypes
    const { endpointType, providerOptionsKey } = resolveEffectiveEndpoint(cherryin, model)
    expect(endpointType).toBe(ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT)
    expect(providerOptionsKey).toBe('google')
  })

  it('still routes claude models to anthropic and gpt to openai via cherryin', () => {
    const claude = makeModel({
      id: 'cherryin::claude-sonnet-4-5',
      providerId: 'cherryin',
      apiModelId: 'claude-sonnet-4-5'
    })
    expect(resolveGatewayChatRoute(cherryin as any, claude as any)?.endpointType).toBe(ENDPOINT_TYPE.ANTHROPIC_MESSAGES)
    const gpt = makeModel({ id: 'cherryin::gpt-4o', providerId: 'cherryin', apiModelId: 'gpt-4o' })
    const gptRoute = resolveGatewayChatRoute(cherryin as any, gpt as any)
    expect(gptRoute?.endpointType).toBe(ENDPOINT_TYPE.OPENAI_RESPONSES)
    expect(gptRoute?.providerOptionsKey).toBe('openai')
  })
})
