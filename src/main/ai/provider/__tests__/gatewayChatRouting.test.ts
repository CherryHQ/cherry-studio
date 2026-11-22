import { describe, expect, it } from 'vitest'

import { resolveGatewayChatRoute } from '@shared/data/presets/gatewayChatRouting'
import { ENDPOINT_TYPE } from '@shared/data/types/model'

import { makeModel } from '../../__tests__/fixtures/model'
import { makeProvider } from '../../__tests__/fixtures/provider'

describe('gateway chat routing', () => {
  it.each(['constructor', '__proto__', 'toString'])('uses the preset route for a custom %s provider', (id) => {
    const model = makeModel({ apiModelId: 'claude-sonnet-5' })
    const provider = makeProvider({
      id,
      presetProviderId: 'aihubmix',
      endpointConfigs: { [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: {} }
    })

    expect(resolveGatewayChatRoute(provider, model)).toEqual({
      endpointType: ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
      providerOptionsKey: 'anthropic'
    })
    expect(resolveGatewayChatRoute({ ...provider, presetProviderId: undefined }, model)).toBeUndefined()
  })
})
