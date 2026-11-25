import { describe, expect, it, vi } from 'vitest'

import { isTrustedClaudeSlot } from '@main/ai/runtime/claudeCode/environment'
import { ENDPOINT_TYPE } from '@shared/data/types/model'

import { makeModel } from '../../../ai/__tests__/fixtures/model'
import { makeProvider } from '../../../ai/__tests__/fixtures/provider'
import { resolveGatewayRequest } from '../gatewayRequest'

const { resolveAddress } = vi.hoisted(() => ({ resolveAddress: vi.fn() }))
vi.mock('../utils/models', () => ({ resolveGatewayModelAddress: resolveAddress }))

describe('internal Claude gateway trust matches forwarding', () => {
  it.each([false, true])('classifies the actual Anthropic route when relay=%s', async (relay) => {
    const provider = makeProvider({
      id: 'anthropic',
      presetProviderId: 'anthropic',
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: {
          baseUrl: relay ? 'https://api.anthropic.com' : 'https://relay.example/v1'
        },
        [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: {
          baseUrl: relay ? 'https://relay.example/v1' : 'https://api.anthropic.com'
        }
      }
    })
    const model = makeModel({
      endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS, ENDPOINT_TYPE.ANTHROPIC_MESSAGES]
    })
    resolveAddress.mockResolvedValue({
      provider,
      model,
      providerId: provider.id,
      apiModelId: model.apiModelId,
      uniqueModelId: model.id
    })
    const route = await resolveGatewayRequest({
      params: { model: model.id, messages: [] },
      inputFormat: 'anthropic',
      agentContext: {
        agentSessionId: 'session',
        reasoningEffort: 'medium',
        fastMode: false,
        resolveUsage: () => undefined
      }
    })
    expect(route.endpoint.endpointType).toBe(ENDPOINT_TYPE.ANTHROPIC_MESSAGES)
    expect(route.endpoint.baseUrl).toBe(provider.endpointConfigs?.[ENDPOINT_TYPE.ANTHROPIC_MESSAGES]?.baseUrl)
    expect(isTrustedClaudeSlot(provider, model)).toBe(!relay)
  })
})
