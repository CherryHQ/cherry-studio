import { beforeEach, describe, expect, it, vi } from 'vitest'

const providerService = vi.hoisted(() => ({
  getByProviderId: vi.fn()
}))

vi.mock('@main/data/services/ProviderService', () => ({
  providerService
}))

const { buildModelSnapshotFromRuntimeModel, resolveSnapshotProviderName } = await import('../modelSnapshot')

describe('modelSnapshot', () => {
  beforeEach(() => {
    providerService.getByProviderId.mockReset()
  })

  it('freezes the producing provider display name on the model snapshot', () => {
    providerService.getByProviderId.mockReturnValue({ name: 'My Relay' })

    expect(
      buildModelSnapshotFromRuntimeModel({
        id: 'openai::gpt-4o',
        providerId: 'openai',
        apiModelId: 'gpt-4o',
        name: 'GPT-4o'
      } as never)
    ).toEqual({
      id: 'gpt-4o',
      name: 'GPT-4o',
      provider: 'openai',
      providerName: 'My Relay'
    })
  })

  it('omits providerName when the provider cannot be resolved', () => {
    providerService.getByProviderId.mockImplementation(() => {
      throw new Error('missing provider')
    })

    expect(resolveSnapshotProviderName('missing')).toBeUndefined()
    expect(
      buildModelSnapshotFromRuntimeModel({
        id: 'missing::gpt-4o',
        providerId: 'missing',
        apiModelId: 'gpt-4o',
        name: 'GPT-4o'
      } as never)
    ).toEqual({
      id: 'gpt-4o',
      name: 'GPT-4o',
      provider: 'missing'
    })
  })
})
