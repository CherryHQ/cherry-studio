import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ provider: vi.fn(), models: vi.fn() }))
vi.mock('@data/services/ProviderService', () => ({ providerService: { getByProviderId: mocks.provider } }))
vi.mock('@data/services/ModelService', () => ({ modelService: { list: mocks.models } }))

import { gatewayPinAddresses, resolveGatewayBudgetSlots } from '../gatewayBudget'

describe('gateway compaction admission', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.provider.mockImplementation((id: string) => ({ id, isEnabled: id !== 'disabled' }))
    mocks.models.mockImplementation(({ providerId }: { providerId: string }) => [
      {
        id: `${providerId}::plan`,
        providerId,
        apiModelId: 'plan-api',
        capabilities: [],
        contextWindow: 64_000,
        maxOutputTokens: 8_192
      }
    ])
  })

  it('excludes the disabled saved plan model while retaining admitted API identities', () => {
    expect(resolveGatewayBudgetSlots(['disabled:plan-api', 'enabled:plan-api'])).toEqual([
      {
        providerId: 'enabled',
        modelId: 'plan',
        contextWindow: 64_000,
        maxOutputTokens: 8_192,
        trusted: false
      }
    ])
  })

  it('excludes a disabled model and a non-chat model using the gateway admission rules', () => {
    mocks.models.mockReturnValue([])
    expect(resolveGatewayBudgetSlots(['enabled:plan-api'])).toEqual([])
    mocks.models.mockReturnValue([
      {
        id: 'enabled::plan',
        providerId: 'enabled',
        apiModelId: 'plan-api',
        capabilities: ['embedding']
      }
    ])
    expect(resolveGatewayBudgetSlots(['enabled:plan-api'])).toEqual([])
  })

  it('covers both explicit pins and preserves provider API ids with embedded colons', () => {
    expect(
      gatewayPinAddresses({
        CLAUDE_CODE_SUBAGENT_MODEL: ' relay:claude:beta ',
        CLAUDE_CODE_WORKFLOW_SUBAGENT_MODEL: 'other:task'
      })
    ).toEqual(['relay:claude:beta', 'other:task'])
    expect(gatewayPinAddresses({ CLAUDE_CODE_SUBAGENT_MODEL: 'inherit' })).toEqual([])
  })
})
