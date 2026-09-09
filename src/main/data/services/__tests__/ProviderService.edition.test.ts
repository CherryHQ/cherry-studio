// Side-effect import: registers ProviderRegistryService in the data-service registry,
// which the edition scope looks up.
import '@data/services/ProviderRegistryService'

import { userProviderTable } from '@data/db/schemas/userProvider'
import { providerService } from '@data/services/ProviderService'
import { ErrorCode } from '@shared/data/api/errors'
import type { AppEdition } from '@shared/types/appEdition'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { applicationEdition, migrationOrigin } = vi.hoisted(() => ({
  applicationEdition: { current: 'cn' as AppEdition },
  migrationOrigin: { current: false }
}))

vi.mock('@main/utils/appEdition', () => ({
  getAppEdition: () => applicationEdition.current
}))

vi.mock('@data/migration/v1MigrationOrigin', () => ({
  isMigratedFromV1: () => migrationOrigin.current
}))

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

describe('ProviderService edition availability', () => {
  const dbh = setupTestDatabase()

  beforeEach(() => {
    applicationEdition.current = 'cn'
    migrationOrigin.current = false
  })

  /**
   * Editions ship one database — seeders and migrators populate both identically —
   * so the rule decides what this build surfaces, never what the profile stores.
   * The row, its name and its API keys survive untouched, and switching back to the
   * global edition restores the provider with everything still on it.
   */
  it('withholds a persisted global-only provider from every surface in China', async () => {
    await dbh.db.insert(userProviderTable).values([
      {
        providerId: 'global-only',
        presetProviderId: 'global-only',
        name: 'Global only',
        apiKeys: [{ id: 'key-1', key: 'secret', isEnabled: true }],
        orderKey: 'a0'
      },
      {
        providerId: 'custom-provider',
        presetProviderId: null,
        name: 'Custom provider',
        orderKey: 'a1'
      }
    ])

    expect(providerService.list({}).map((provider) => provider.id)).toEqual(['custom-provider'])
    expect(providerService.listAvailableProviderIds()).toEqual(new Set(['custom-provider']))
    expect(providerService.listAvailableProviderIds(['global-only', 'custom-provider'])).toEqual(
      new Set(['custom-provider'])
    )
    expect(providerService.isAvailableByProviderId('global-only')).toBe(false)
    expect(() => providerService.getByProviderId('global-only')).toThrowError(
      expect.objectContaining({ code: ErrorCode.NOT_FOUND })
    )

    const [persisted] = await dbh.db
      .select()
      .from(userProviderTable)
      .where(eq(userProviderTable.providerId, 'global-only'))
    expect(persisted.name).toBe('Global only')
    expect(persisted.apiKeys).toEqual([{ id: 'key-1', key: 'secret', isEnabled: true }])
  })

  it('rejects creating a provider from a preset unavailable in the current edition', async () => {
    expect(() =>
      providerService.create({
        providerId: 'global-only-copy',
        presetProviderId: 'global-only',
        name: 'Global only copy'
      })
    ).toThrowError(expect.objectContaining({ code: ErrorCode.INVALID_OPERATION }))

    const rows = await dbh.db
      .select()
      .from(userProviderTable)
      .where(eq(userProviderTable.providerId, 'global-only-copy'))
    expect(rows).toEqual([])
  })

  it('keeps the same persisted provider available in the global edition', async () => {
    applicationEdition.current = 'global'
    await dbh.db.insert(userProviderTable).values({
      providerId: 'global-only',
      presetProviderId: 'global-only',
      name: 'Global only',
      orderKey: 'a0'
    })

    expect(providerService.getByProviderId('global-only').id).toBe('global-only')
  })

  /**
   * Withholding needs a positive statement in the catalog. Treating an unlisted
   * preset as withheld would make every provider the catalog drops disappear from
   * the profiles still using it — and would leave a partially readable registry
   * silently revoking providers instead of reporting a problem.
   */
  it('keeps a provider the catalog does not list, while still withholding a listed one', async () => {
    await dbh.db.insert(userProviderTable).values([
      {
        providerId: 'not-in-catalog',
        presetProviderId: 'not-in-catalog',
        name: 'Dropped from the catalog',
        orderKey: 'a0'
      },
      { providerId: 'global-only', presetProviderId: 'global-only', name: 'Global only', orderKey: 'a1' }
    ])

    expect(providerService.list({}).map((provider) => provider.id)).toEqual(['not-in-catalog'])
    expect(providerService.getByProviderId('not-in-catalog').id).toBe('not-in-catalog')
  })

  it('keeps every persisted provider available for users migrated from v1', async () => {
    migrationOrigin.current = true
    await dbh.db.insert(userProviderTable).values({
      providerId: 'global-only',
      presetProviderId: 'global-only',
      name: 'Global only',
      orderKey: 'a0'
    })

    expect(providerService.list({}).map((provider) => provider.id)).toEqual(['global-only'])
  })
})
