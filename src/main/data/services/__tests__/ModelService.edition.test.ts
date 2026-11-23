import { setupTestDatabase } from '@test-helpers/db'
import { describe, expect, it, vi } from 'vitest'

import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { modelService } from '@data/services/ModelService'
import { createUniqueModelId } from '@shared/data/types/model'
vi.mock('@cherrystudio/provider-registry/node', () => {
  class RegistryLoader {
    loadProviders() {
      return [
        {
          id: 'global-only',
          availableInEditions: ['global'],
          endpointConfigs: {},
          metadata: {}
        },
        {
          id: 'cn-provider',
          availableInEditions: ['cn'],
          endpointConfigs: {},
          metadata: {}
        }
      ]
    }
    loadModels() {
      return []
    }
    loadProviderModels() {
      return []
    }
    findModel() {
      return null
    }
    findOverride() {
      return null
    }
  }
  return { RegistryLoader }
})

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

describe('ModelService desktop catalog', () => {
  const dbh = setupTestDatabase()

  it('lists and resolves enabled models from both region-scoped presets', () => {
    dbh.db
      .insert(userProviderTable)
      .values([
        { providerId: 'global-only', presetProviderId: 'global-only', name: 'Global only', orderKey: 'a0' },
        { providerId: 'cn-provider', presetProviderId: 'cn-provider', name: 'CN provider', orderKey: 'a1' }
      ])
      .run()
    dbh.db
      .insert(userModelTable)
      .values([modelRow('global-only', 'model', 'a0'), modelRow('cn-provider', 'model', 'a0')])
      .run()

    expect(modelService.list({ enabled: true }).map((model) => model.id)).toEqual(
      expect.arrayContaining(['global-only::model', 'cn-provider::model'])
    )
    expect(modelService.findByIdTx(dbh.db, 'cn-provider::model')?.id).toBe('cn-provider::model')
    expect(modelService.existsByIdTx(dbh.db, 'global-only::model')).toBe(true)
  })
})
