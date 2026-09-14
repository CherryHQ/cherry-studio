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

vi.mock('@cherrystudio/provider-registry/node', () => {
  class RegistryLoader {
    loadProviders() {
      return [
        {
          id: 'openai',
          name: 'OpenAI',
          availableInEditions: ['global'],
          endpointConfigs: {}
        },
        {
          id: 'anthropic',
          name: 'Anthropic',
          availableInEditions: ['global'],
          endpointConfigs: {}
        },
        {
          id: 'gemini',
          name: 'Gemini',
          availableInEditions: ['global'],
          endpointConfigs: {}
        },
        {
          id: 'global-only',
          availableInEditions: ['global'],
          endpointConfigs: {}
        },
        {
          id: 'deepseek',
          name: 'DeepSeek',
          availableInEditions: ['global', 'cn'],
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

  it('makes a persisted global-only provider unavailable to every runtime read and mutation in China', async () => {
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

    const displayMetadataSpy = vi.spyOn(providerRegistryService, 'getProviderDisplayMetadata')
    expect(providerService.list({}).map((provider) => provider.id)).toEqual(['custom-provider'])
    expect(displayMetadataSpy).toHaveBeenCalledTimes(2)
    displayMetadataSpy.mockRestore()
    expect(providerService.listAvailableProviderIds()).toEqual(new Set(['custom-provider']))
    expect(providerService.listAvailableProviderIds(['global-only', 'custom-provider'])).toEqual(
      new Set(['custom-provider'])
    )
    expect(providerService.isAvailableByProviderId('global-only')).toBe(false)

    const calls: Array<() => unknown> = [
      () => providerService.assertAvailable('global-only'),
      () => providerService.getByProviderId('global-only'),
      () => providerService.resolveApiKey('global-only'),
      () => providerService.getApiKeys('global-only'),
      () => providerService.getAuthConfig('global-only'),
      () => providerService.addApiKey('global-only', 'new-secret'),
      () => providerService.replaceApiKeys('global-only', []),
      () => providerService.updateApiKey('global-only', 'key-1', { label: 'Changed' }),
      () => providerService.deleteApiKey('global-only', 'key-1'),
      () => providerService.update('global-only', { name: 'Changed' }),
      () => providerService.move('global-only', { position: 'last' }),
      () => providerService.reorder([{ id: 'global-only', anchor: { position: 'last' } }]),
      () => providerService.delete('global-only')
    ]

    for (const invoke of calls) {
      expect(invoke).toThrowError(expect.objectContaining({ code: ErrorCode.NOT_FOUND }))
    }

    const [persisted] = await dbh.db
      .select()
      .from(userProviderTable)
      .where(eq(userProviderTable.providerId, 'global-only'))
    expect(persisted.name).toBe('Global only')
    expect(persisted.apiKeys).toEqual([{ id: 'key-1', key: 'secret', isEnabled: true }])
  })

  it('enforces edition availability in provider-backed registry reads', async () => {
    await dbh.db.insert(userProviderTable).values({
      providerId: 'global-only',
      presetProviderId: 'global-only',
      name: 'Global only',
      orderKey: 'a0'
    })

    expect(() => providerRegistryService.resolveModels('global-only', ['model'])).toThrowError(
      expect.objectContaining({ code: ErrorCode.NOT_FOUND })
    )
    expect(() => providerRegistryService.getImageGenerationSupport('global-only', 'model')).toThrowError(
      expect.objectContaining({ code: ErrorCode.NOT_FOUND })
    )
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

  it('seeds the default trio on fresh installs: listed on global, hidden but kept on cn', async () => {
    await dbh.db.insert(userProviderTable).values([
      { providerId: 'openai', presetProviderId: 'openai', name: 'OpenAI', orderKey: 'a0' },
      { providerId: 'anthropic', presetProviderId: 'anthropic', name: 'Anthropic', orderKey: 'a1' },
      { providerId: 'gemini', presetProviderId: 'gemini', name: 'Gemini', orderKey: 'a2' },
      { providerId: 'deepseek', presetProviderId: 'deepseek', name: 'DeepSeek', orderKey: 'a3' },
      { providerId: 'custom-provider', presetProviderId: null, name: 'Custom provider', orderKey: 'a4' }
    ])

    // cn packaged build: the trio is seeded but filtered, everything else stays.
    expect(providerService.list({}).map((provider) => provider.id)).toEqual(['deepseek', 'custom-provider'])
    expect(providerService.listEditionHiddenProviderIds().sort()).toEqual(['anthropic', 'gemini', 'openai'])

    // Same database on a global build: the trio comes back with no data loss.
    applicationEdition.current = 'global'
    expect(providerService.list({}).map((provider) => provider.id)).toEqual([
      'openai',
      'anthropic',
      'gemini',
      'deepseek',
      'custom-provider'
    ])
    expect(providerService.listEditionHiddenProviderIds()).toEqual([])
  })

  it('reports nothing hidden on global builds or for v1-migrated installs', async () => {
    await dbh.db.insert(userProviderTable).values({
      providerId: 'global-only',
      presetProviderId: 'global-only',
      name: 'Global only',
      orderKey: 'a0'
    })

    applicationEdition.current = 'global'
    expect(providerService.listEditionHiddenProviderIds()).toEqual([])

    applicationEdition.current = 'cn'
    migrationOrigin.current = true
    expect(providerService.listEditionHiddenProviderIds()).toEqual([])
  })

  it('never reports retired or custom providers as edition-hidden', async () => {
    await dbh.db.insert(userProviderTable).values([
      { providerId: 'custom-provider', presetProviderId: null, name: 'Custom provider', orderKey: 'a0' },
      { providerId: 'deepseek', presetProviderId: 'deepseek', name: 'DeepSeek', orderKey: 'a1' },
      { providerId: 'yi', presetProviderId: 'yi', name: 'Yi', orderKey: 'a2' }
    ])

    expect(providerService.listEditionHiddenProviderIds()).toEqual([])
  })
})
