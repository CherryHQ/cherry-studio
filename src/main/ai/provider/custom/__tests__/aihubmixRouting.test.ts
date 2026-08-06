import type { ProviderModelRoute } from '@cherrystudio/provider-registry'
import { ENDPOINT_TYPE } from '@shared/data/types/model'
import { describe, expect, it } from 'vitest'

import { resolveAihubmixChatFamily } from '../aihubmix/aihubmixRouting'

const route = (endpointType: ProviderModelRoute['endpointType']): ProviderModelRoute => ({
  pattern: 'irrelevant',
  endpointType,
  providerOptionsKey: 'irrelevant'
})

// Which ids reach which endpoint is registry data (packages/provider-registry `modelRouting`,
// covered by its own test). This maps that endpoint onto the SDK model class, and must stay in
// lock-step with `createChatModel`'s dispatch in aihubmixProvider.ts.
describe('resolveAihubmixChatFamily', () => {
  it.each([
    [ENDPOINT_TYPE.ANTHROPIC_MESSAGES, 'anthropic'],
    [ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT, 'gemini'],
    [ENDPOINT_TYPE.OPENAI_RESPONSES, 'openai-responses'],
    [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS, 'openai-chat']
  ] as const)('maps %s → %s', (endpointType, family) => {
    expect(resolveAihubmixChatFamily(route(endpointType))).toBe(family)
  })

  it('falls back to the openai-compatible passthrough for unrouted models', () => {
    expect(resolveAihubmixChatFamily(undefined)).toBe('compat')
  })
})
