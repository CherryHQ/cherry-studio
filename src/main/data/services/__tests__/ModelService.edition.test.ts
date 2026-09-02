import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { modelService } from '@data/services/ModelService'
import { DataApiErrorFactory, ErrorCode } from '@shared/data/api/errors'
import { createUniqueModelId } from '@shared/data/types/model'
import { setupTestDatabase } from '@test-helpers/db'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const providerMocks = vi.hoisted(() => ({
  availableIds: new Set<string>(),
  getByProviderId: vi.fn(),
  isAvailableByProviderId: vi.fn(),
  listAvailableProviderIds: vi.fn()
}))

vi.mock('@data/services/ProviderService', () => ({
  providerService: {
    getByProviderId: providerMocks.getByProviderId,
    isAvailableByProviderId: providerMocks.isAvailableByProviderId,
    listAvailableProviderIds: providerMocks.listAvailableProviderIds
  }
}))

vi.mock('@data/services/ProviderRegistryService', () => ({
  providerRegistryService: {
    lookupModel: vi.fn(() => ({
      presetModel: null,
      registryOverride: null,
      reasoningProfile: { format: 'none', wire: { disabled: true } }
    }))
  }
}))

const modelRow = (providerId: string, modelId: string, orderKey: string) => ({
  id: createUniqueModelId(providerId, modelId),
  providerId,
  modelId,
  name: modelId,
  capabilities: [],
  supportsStreaming: true,
  isEnabled: true,
  isHidden: false,
  isDeprecated: false,
  orderKey
})

describe('ModelService edition availability', () => {
  const dbh = setupTestDatabase()

  beforeEach(() => {
    providerMocks.availableIds.clear()
    providerMocks.availableIds.add('cn-provider')
    providerMocks.getByProviderId.mockReset().mockImplementation((providerId: string) => {
      if (!providerMocks.availableIds.has(providerId)) {
        throw DataApiErrorFactory.notFound('Provider', providerId)
      }
      return { id: providerId }
    })
    providerMocks.isAvailableByProviderId
      .mockReset()
      .mockImplementation((providerId: string) => providerMocks.availableIds.has(providerId))
    providerMocks.listAvailableProviderIds.mockReset().mockImplementation(() => new Set(providerMocks.availableIds))
  })

  it('excludes persisted models owned by providers unavailable in the current edition', async () => {
    await dbh.db.insert(userProviderTable).values([
      { providerId: 'global-only', name: 'Global only', orderKey: 'a0' },
      { providerId: 'cn-provider', name: 'CN provider', orderKey: 'a1' }
    ])
    await dbh.db
      .insert(userModelTable)
      .values([modelRow('global-only', 'hidden-model', 'a0'), modelRow('cn-provider', 'visible-model', 'a0')])

    expect(modelService.list({}).map((model) => model.id)).toEqual(['cn-provider::visible-model'])
    expect(modelService.findByIdTx(dbh.db, 'global-only::hidden-model')).toBeNull()
    expect(modelService.existsByIdTx(dbh.db, 'global-only::hidden-model')).toBe(false)
    expect(modelService.getNamesByUniqueIdsTx(dbh.db, ['global-only::hidden-model'])).toEqual(new Map())
  })

  it('rejects direct model resolution for an unavailable provider', () => {
    expect(() => modelService.getByKey('global-only', 'hidden-model')).toThrowError(
      expect.objectContaining({ code: ErrorCode.NOT_FOUND })
    )
  })

  it('rejects creating models for an unavailable provider before writing rows', async () => {
    await dbh.db.insert(userProviderTable).values({
      providerId: 'global-only',
      name: 'Global only',
      orderKey: 'a0'
    })

    expect(() =>
      modelService.create([
        {
          dto: {
            providerId: 'global-only',
            modelId: 'hidden-model'
          }
        }
      ])
    ).toThrowError(expect.objectContaining({ code: ErrorCode.NOT_FOUND }))

    expect(await dbh.db.select().from(userModelTable)).toEqual([])
  })
})
