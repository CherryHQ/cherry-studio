import { resolve } from 'node:path'

import { application } from '@application'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { modelService } from '@data/services/ModelService'
import { providerRegistryService } from '@data/services/ProviderRegistryService'
import { MODEL_CAPABILITY } from '@shared/data/types/model'
import { setupTestDatabase } from '@test-helpers/db'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PresetModelOverrideUnfreezeSeeder } from '../PresetModelOverrideUnfreezeSeeder'

const legacyCapabilities = [
  MODEL_CAPABILITY.FILE_INPUT,
  MODEL_CAPABILITY.STRUCTURED_OUTPUT,
  MODEL_CAPABILITY.IMAGE_RECOGNITION,
  MODEL_CAPABILITY.FUNCTION_CALL
]

describe('preset override cleanup against the bundled catalog', () => {
  const dbh = setupTestDatabase()
  beforeEach(() => {
    providerRegistryService.clearCache()
    vi.spyOn(application, 'getPath').mockImplementation((key, filename) =>
      resolve(
        key === 'app.root'
          ? '.'
          : key === 'feature.provider_registry.data'
            ? 'packages/provider-registry/data'
            : '.context/nonexistent-registry',
        filename ?? ''
      )
    )
    dbh.db
      .insert(userProviderTable)
      .values({ providerId: 'openai', presetProviderId: 'openai', name: 'OpenAI', orderKey: 'a0' })
      .run()
  })
  afterEach(() => {
    vi.restoreAllMocks()
    providerRegistryService.clearCache()
  })

  it('unfreezes a real pre-operation GPT-4o snapshot while keeping an explicit Jamba modality clear', () => {
    dbh.db
      .insert(userModelTable)
      .values([
        {
          id: 'openai::gpt-4o',
          providerId: 'openai',
          modelId: 'gpt-4o',
          presetModelId: 'gpt-4o',
          capabilities: legacyCapabilities,
          orderKey: 'a0'
        },
        {
          id: 'openai::jamba-1-5-large',
          providerId: 'openai',
          modelId: 'jamba-1-5-large',
          presetModelId: 'jamba-1-5-large',
          inputModalities: [],
          orderKey: 'a1'
        }
      ])
      .run()
    new PresetModelOverrideUnfreezeSeeder().run(dbh.db)
    const rows = dbh.db.select().from(userModelTable).all()
    expect(rows.find((row) => row.modelId === 'gpt-4o')?.capabilities).toBeNull()
    const gpt = modelService.getByKey('openai', 'gpt-4o')
    expect(gpt.capabilities).toEqual(expect.arrayContaining([...legacyCapabilities, MODEL_CAPABILITY.TEXT_GENERATION]))
    expect(gpt.overrides?.capabilities).toBeUndefined()
    const jamba = modelService.getByKey('openai', 'jamba-1-5-large')
    expect(jamba.inputModalities).toEqual([])
    expect(jamba.overrides?.inputModalities).toBe(true)
  })

  it('rolls back earlier cleanup writes when a later row fails', () => {
    dbh.db
      .insert(userModelTable)
      .values([
        {
          id: 'openai::gpt-4o',
          providerId: 'openai',
          modelId: 'gpt-4o',
          presetModelId: 'gpt-4o',
          capabilities: legacyCapabilities,
          orderKey: 'a0'
        },
        {
          id: 'openai::jamba-1-5-large',
          providerId: 'openai',
          modelId: 'jamba-1-5-large',
          presetModelId: 'jamba-1-5-large',
          name: 'jamba-1-5-large',
          orderKey: 'a1'
        }
      ])
      .run()
    dbh.sqlite.exec(
      "CREATE TRIGGER reject_cleanup BEFORE UPDATE ON user_model WHEN OLD.model_id = 'jamba-1-5-large' BEGIN SELECT RAISE(ABORT, 'cleanup rejected'); END"
    )
    try {
      expect(() => new PresetModelOverrideUnfreezeSeeder().run(dbh.db)).toThrow()
      expect(
        dbh.db
          .select()
          .from(userModelTable)
          .all()
          .find((row) => row.modelId === 'gpt-4o')?.capabilities
      ).toEqual(legacyCapabilities)
    } finally {
      dbh.sqlite.exec('DROP TRIGGER reject_cleanup')
    }
  })
})
