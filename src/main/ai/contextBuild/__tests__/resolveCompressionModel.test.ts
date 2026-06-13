import { describe, expect, it, vi } from 'vitest'

import { resolveCompressionModel } from '../resolveCompressionModel'

vi.mock('@main/data/services/ProviderService', () => ({
  providerService: { getByProviderId: vi.fn() }
}))
vi.mock('@main/data/services/ModelService', () => ({
  modelService: { getByKey: vi.fn() }
}))

describe('resolveCompressionModel', () => {
  it('returns null for a non-UniqueModelId string', async () => {
    expect(await resolveCompressionModel('not-a-unique-id')).toBeNull()
  })

  it('returns null when provider/model lookup throws', async () => {
    const { providerService } = await import('@main/data/services/ProviderService')
    vi.mocked(providerService.getByProviderId).mockRejectedValueOnce(new Error('no such provider'))
    expect(await resolveCompressionModel('ghost::model-x')).toBeNull()
  })
})
