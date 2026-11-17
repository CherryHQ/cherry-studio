import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { userProviderTable } from '@data/db/schemas/userProvider'
import { providerRegistryService } from '@data/services/ProviderRegistryService'
import { providerService } from '@data/services/ProviderService'
import { ErrorCode } from '@shared/data/api/errors'
const { applicationEdition, migrationOrigin } = vi.hoisted(() => ({
  applicationEdition: { current: 'cn' },
  migrationOrigin: { current: false }
}))

vi.mock('@main/utils/appEdition', () => ({
  getAppEdition: () => applicationEdition.current
}))

vi.mock('@data/migration/v1MigrationOrigin', () => ({
  isMigratedFromV1: () => migrationOrigin.current
}))

vi.mock('@cherrystudio/provider-registry/node', async () => {
  const { default: catalog } = await import('../../../../../packages/provider-registry/data/providers.json')
  class RegistryLoader {
    loadProviders() {
      return catalog.providers.filter((provider) => provider.id === 'fortytwo')
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

  it('makes a persisted global-only provider unavailable to every runtime read and mutation in China', async () => {
    await dbh.db.insert(userProviderTable).values([
      {
        providerId: 'fortytwo',
        presetProviderId: 'fortytwo',
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

    const displayMetadataSpy = vi.spyOn(providerRegistryService, 'getProviderDisplayMetadata')
    expect(providerService.list({}).map((provider) => provider.id)).toEqual(['custom-provider'])
    expect(displayMetadataSpy).toHaveBeenCalledTimes(2)
    displayMetadataSpy.mockRestore()
    expect(providerService.listAvailableProviderIds()).toEqual(new Set(['custom-provider']))
    expect(providerService.listAvailableProviderIds(['fortytwo', 'custom-provider'])).toEqual(
      new Set(['custom-provider'])
    )
    expect(providerService.isAvailableByProviderId('fortytwo')).toBe(false)

    const calls: Array<() => unknown> = [
      () => providerService.assertAvailable('fortytwo'),
      () => providerService.getByProviderId('fortytwo'),
      () => providerService.resolveApiKey('fortytwo'),
      () => providerService.getApiKeys('fortytwo'),
      () => providerService.getAuthConfig('fortytwo'),
      () => providerService.addApiKey('fortytwo', 'new-secret'),
      () => providerService.replaceApiKeys('fortytwo', []),
      () => providerService.updateApiKey('fortytwo', 'key-1', { label: 'Changed' }),
      () => providerService.deleteApiKey('fortytwo', 'key-1'),
      () => providerService.update('fortytwo', { name: 'Changed' }),
      () => providerService.move('fortytwo', { position: 'last' }),
      () => providerService.reorder([{ id: 'fortytwo', anchor: { position: 'last' } }]),
      () => providerService.delete('fortytwo')
    ]

    for (const invoke of calls) {
      expect(invoke).toThrowError(expect.objectContaining({ code: ErrorCode.NOT_FOUND }))
    }

    const [persisted] = await dbh.db
      .select()
      .from(userProviderTable)
      .where(eq(userProviderTable.providerId, 'fortytwo'))
    expect(persisted.name).toBe('Global only')
    expect(persisted.apiKeys).toEqual([{ id: 'key-1', key: 'secret', isEnabled: true }])
  })

  it('enforces edition availability in provider-backed registry reads', async () => {
    await dbh.db.insert(userProviderTable).values({
      providerId: 'fortytwo',
      presetProviderId: 'fortytwo',
      name: 'Global only',
      orderKey: 'a0'
    })

    expect(() => providerRegistryService.resolveModels('fortytwo', ['model'])).toThrowError(
      expect.objectContaining({ code: ErrorCode.NOT_FOUND })
    )
    expect(() => providerRegistryService.getImageGenerationSupport('fortytwo', 'model')).toThrowError(
      expect.objectContaining({ code: ErrorCode.NOT_FOUND })
    )
  })

  it('rejects creating a provider from a preset unavailable in the current edition', async () => {
    expect(() =>
      providerService.create({
        providerId: 'global-only-copy',
        presetProviderId: 'fortytwo',
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
      providerId: 'fortytwo',
      presetProviderId: 'fortytwo',
      name: 'Global only',
      orderKey: 'a0'
    })

    expect(providerService.getByProviderId('fortytwo').id).toBe('fortytwo')
  })

  it('keeps every persisted provider available for users migrated from v1', async () => {
    migrationOrigin.current = true
    await dbh.db.insert(userProviderTable).values({
      providerId: 'fortytwo',
      presetProviderId: 'fortytwo',
      name: 'Global only',
      orderKey: 'a0'
    })

    expect(providerService.list({}).map((provider) => provider.id)).toEqual(['fortytwo'])
  })
})
