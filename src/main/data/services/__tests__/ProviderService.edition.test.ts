import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { modelService } from '@data/services/ModelService'
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
          id: 'global-only',
          availableInEditions: ['global'],
          endpointConfigs: {}
        },
        {
          id: 'dashscope',
          availableInEditions: ['cn'],
          endpointConfigs: {}
        },
        {
          id: 'qwencloud',
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

    expect(providerService.list({}).map((provider) => provider.id)).toEqual(['custom-provider'])
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

  it('retains the v1 edition exemption for unrelated providers', async () => {
    migrationOrigin.current = true
    await dbh.db.insert(userProviderTable).values({
      providerId: 'global-only',
      presetProviderId: 'global-only',
      name: 'Global only',
      orderKey: 'a0'
    })

    expect(providerService.list({}).map((provider) => provider.id)).toEqual(['global-only'])
  })

  it.each([
    ['cn', false, 'dashscope', 'qwencloud'],
    ['cn', true, 'dashscope', 'qwencloud'],
    ['global', false, 'qwencloud', 'dashscope'],
    ['global', true, 'qwencloud', 'dashscope']
  ] as const)('isolates Qwen providers and copies in %s (v1 migration: %s)', (edition, migrated, allowed, hidden) => {
    applicationEdition.current = edition
    migrationOrigin.current = migrated
    const ids = [allowed, `${allowed}-copy`, hidden, `${hidden}-copy`]
    for (const id of ids) {
      dbh.db
        .insert(userProviderTable)
        .values({
          providerId: id,
          presetProviderId: id.replace('-copy', ''),
          name: id,
          orderKey: id,
          apiKeys: [{ id: 'key', key: 'saved-secret', isEnabled: true }]
        })
        .run()
      dbh.db
        .insert(userModelTable)
        .values({
          id: `${id}::model`,
          providerId: id,
          modelId: 'model',
          name: 'Saved model',
          capabilities: [],
          supportsStreaming: true,
          orderKey: 'a0'
        })
        .run()
    }
    const providersBefore = dbh.db.select().from(userProviderTable).all()
    const modelsBefore = dbh.db.select().from(userModelTable).all()

    expect(
      providerService
        .list({})
        .map((row) => row.id)
        .sort()
    ).toEqual([allowed, `${allowed}-copy`].sort())
    expect(
      modelService
        .list({})
        .map((row) => row.providerId)
        .sort()
    ).toEqual([allowed, `${allowed}-copy`].sort())
    for (const id of [hidden, `${hidden}-copy`]) {
      expect(() => providerService.getByProviderId(id)).toThrowError(
        expect.objectContaining({ code: ErrorCode.NOT_FOUND })
      )
      expect(() => providerService.resolveApiKey(id)).toThrowError(
        expect.objectContaining({ code: ErrorCode.NOT_FOUND })
      )
      expect(() => modelService.getByKey(id, 'model')).toThrowError(
        expect.objectContaining({ code: ErrorCode.NOT_FOUND })
      )
      expect(() => providerRegistryService.resolveModels(id, ['model'])).toThrowError(
        expect.objectContaining({ code: ErrorCode.NOT_FOUND })
      )
    }
    expect(() =>
      providerService.create({ providerId: 'new-copy', presetProviderId: hidden, name: 'New copy' })
    ).toThrowError(expect.objectContaining({ code: ErrorCode.INVALID_OPERATION }))
    expect(dbh.db.select().from(userProviderTable).all()).toEqual(providersBefore)
    expect(dbh.db.select().from(userModelTable).all()).toEqual(modelsBefore)

    const created = providerService.create({ providerId: 'allowed-copy', presetProviderId: allowed, name: 'Allowed' })
    expect(created.presetProviderId).toBe(allowed)
  })
})
