import type { ResolvedModelRoute } from '@cherrystudio/provider-registry'
import { ENDPOINT_TYPE } from '@shared/data/types/model'
import { describe, expect, it } from 'vitest'

import { resolveDmxapiChatFamily } from '../dmxapi/dmxapiRouting'

const route = (endpointType: ResolvedModelRoute['endpointType']): ResolvedModelRoute => ({
  endpointType,
  providerOptionsKey: 'irrelevant'
})

// Which ids reach which endpoint is registry data (packages/provider-registry endpoint `serves`,
// covered by its own test); this only maps that endpoint onto the SDK model class.
describe('resolveDmxapiChatFamily', () => {
  it.each([
    [ENDPOINT_TYPE.ANTHROPIC_MESSAGES, 'anthropic'],
    [ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT, 'gemini'],
    [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS, 'openai']
  ] as const)('maps %s → %s', (endpointType, family) => {
    expect(resolveDmxapiChatFamily(route(endpointType))).toBe(family)
  })

  it('falls back to the openai-compatible passthrough for unrouted models', () => {
    expect(resolveDmxapiChatFamily(undefined)).toBe('openai-compat')
  })
})
