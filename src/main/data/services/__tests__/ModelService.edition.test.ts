import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { modelService } from '@data/services/ModelService'
import { ErrorCode } from '@shared/data/api/errors'
import { createUniqueModelId } from '@shared/data/types/model'
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

describe('ModelService edition availability', () => {
  const dbh = setupTestDatabase()

  beforeEach(() => {
    applicationEdition.current = 'cn'
    migrationOrigin.current = false
  })

  it('excludes persisted models owned by providers unavailable in the current edition', async () => {
    await dbh.db.insert(userProviderTable).values([
      {
        providerId: 'global-only',
        presetProviderId: 'global-only',
        name: 'Global only',
        orderKey: 'a0'
      },
      {
        providerId: 'cn-provider',
        presetProviderId: 'cn-provider',
        name: 'CN provider',
        orderKey: 'a1'
      }
    ])
    await dbh.db
      .insert(userModelTable)
      .values([modelRow('global-only', 'hidden-model', 'a0'), modelRow('cn-provider', 'visible-model', 'a0')])

    expect(modelService.list({}).map((model) => model.id)).toEqual(['cn-provider::visible-model'])
    expect(modelService.list({ providerId: 'global-only' })).toEqual([])
    expect(modelService.findByIdTx(dbh.db, 'global-only::hidden-model')).toBeNull()
    expect(modelService.existsByIdTx(dbh.db, 'global-only::hidden-model')).toBe(false)
    expect(modelService.getNamesByUniqueIdsTx(dbh.db, ['global-only::hidden-model'])).toEqual(new Map())
  })

  /**
   * Editions ship one database, so the rule withholds the model from every surface
   * without withholding the row: a write still lands, and switching back to the
   * global edition brings the model back with the edit on it.
   */
  it('withholds the model from reads while leaving the row writable', async () => {
    await dbh.db.insert(userProviderTable).values({
      providerId: 'global-only',
      presetProviderId: 'global-only',
      name: 'Global only',
      orderKey: 'a0'
    })
    await dbh.db.insert(userModelTable).values(modelRow('global-only', 'hidden-model', 'a0'))

    expect(() => modelService.getByKey('global-only', 'hidden-model')).toThrowError(
      expect.objectContaining({ code: ErrorCode.NOT_FOUND })
    )
    expect(modelService.list({}).map((model) => model.id)).toEqual([])

    modelService.update('global-only', 'hidden-model', { name: 'changed' })

    const rows = await dbh.db.select().from(userModelTable).where(eq(userModelTable.providerId, 'global-only'))
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('changed')
  })

  it('keeps every persisted model available for users migrated from v1', async () => {
    migrationOrigin.current = true
    await dbh.db.insert(userProviderTable).values({
      providerId: 'global-only',
      presetProviderId: 'global-only',
      name: 'Global only',
      orderKey: 'a0'
    })
    await dbh.db.insert(userModelTable).values(modelRow('global-only', 'visible-model', 'a0'))

    expect(modelService.list({}).map((model) => model.id)).toEqual(['global-only::visible-model'])
  })
})
