import { setupTestDatabase } from '@test-helpers/db'
import { describe, expect, it, vi } from 'vitest'

import { userProviderTable } from '@data/db/schemas/userProvider'
import '@data/services/ProviderRegistryService'
import { providerService } from '@data/services/ProviderService'
vi.mock('@cherrystudio/provider-registry/node', () => {
  class RegistryLoader {
    loadProviders() {
      return [
        {
          id: 'global-only',
          availableInEditions: ['global'],
          endpointConfigs: {}
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

describe('ProviderService desktop catalog', () => {
  const dbh = setupTestDatabase()

  it('lists an unconfigured region-scoped preset and allows creating a provider from it', () => {
    dbh.db
      .insert(userProviderTable)
      .values({
        providerId: 'global-only',
        presetProviderId: 'global-only',
        name: 'Global only',
        orderKey: 'a0'
      })
      .run()

    expect(providerService.list({}).map((provider) => provider.id)).toContain('global-only')
    expect(providerService.list({ enabled: true })).toEqual([])
    expect(
      providerService.create({
        providerId: 'global-only-copy',
        presetProviderId: 'global-only',
        name: 'Global only copy'
      }).id
    ).toBe('global-only-copy')
  })
})
