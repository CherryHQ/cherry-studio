import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { modelService } from '@data/services/ModelService'
import { ErrorCode } from '@shared/data/api/errors'
import { createUniqueModelId } from '@shared/data/types/model'
import type { AppEdition } from '@shared/types/appEdition'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { applicationEdition } = vi.hoisted(() => ({
  applicationEdition: { current: 'cn' as AppEdition }
}))

vi.mock('@main/utils/appEdition', () => ({
  getAppEdition: () => applicationEdition.current
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

  it('rejects every direct read and write path for an unavailable persisted provider before mutation', async () => {
    await dbh.db.insert(userProviderTable).values({
      providerId: 'global-only',
      presetProviderId: 'global-only',
      name: 'Global only',
      orderKey: 'a0'
    })
    await dbh.db.insert(userModelTable).values(modelRow('global-only', 'hidden-model', 'a0'))

    const calls: Array<[string, () => unknown]> = [
      ['getByKey', () => modelService.getByKey('global-only', 'hidden-model')],
      ['create', () => modelService.create([{ dto: { providerId: 'global-only', modelId: 'new-model' } }])],
      ['update', () => modelService.update('global-only', 'hidden-model', { name: 'changed' })],
      [
        'bulkUpdate',
        () =>
          modelService.bulkUpdate([{ providerId: 'global-only', modelId: 'hidden-model', patch: { name: 'changed' } }])
      ],
      ['reconcileForProvider', () => modelService.reconcileForProvider('global-only', { toAdd: [], toRemove: [] })],
      ['delete', () => modelService.delete('global-only', 'hidden-model')],
      ['bulkDelete', () => modelService.bulkDelete([{ providerId: 'global-only', modelId: 'hidden-model' }])]
    ]

    for (const [, invoke] of calls) {
      expect(invoke).toThrowError(expect.objectContaining({ code: ErrorCode.NOT_FOUND }))
    }

    const rows = await dbh.db.select().from(userModelTable).where(eq(userModelTable.providerId, 'global-only'))
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('hidden-model')
  })
})
