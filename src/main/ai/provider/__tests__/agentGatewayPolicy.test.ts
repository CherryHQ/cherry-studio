import { CHERRY_CLOUD_PROVIDER_ID } from '@shared/data/presets/cherryai'
import { describe, expect, it } from 'vitest'

import { requiresAgentGateway } from '../agentGatewayPolicy'

describe('requiresAgentGateway', () => {
  it('routes the managed subscription provider through the Agent Gateway', () => {
    expect(requiresAgentGateway(CHERRY_CLOUD_PROVIDER_ID)).toBe(true)
  })

  it('leaves ordinary providers on their normal route', () => {
    expect(requiresAgentGateway('anthropic')).toBe(false)
  })
})
