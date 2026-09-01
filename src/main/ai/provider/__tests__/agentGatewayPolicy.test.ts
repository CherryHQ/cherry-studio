import { CHERRY_CLOUD_PROVIDER_ID } from '@shared/data/presets/cherryai'
import { describe, expect, it } from 'vitest'

import { getProviderAgentGatewayPolicy } from '../agentGatewayPolicy'

describe('getProviderAgentGatewayPolicy', () => {
  it('restricts the managed subscription provider to internal Agent requests', () => {
    const policy = getProviderAgentGatewayPolicy(CHERRY_CLOUD_PROVIDER_ID)

    expect(policy?.authorizeRequest({ isInternalAgentRequest: true })).toBe(true)
    expect(policy?.authorizeRequest({ isInternalAgentRequest: false })).toBe(false)
  })

  it('leaves ordinary providers on their normal route', () => {
    expect(getProviderAgentGatewayPolicy('anthropic')).toBeUndefined()
  })
})
