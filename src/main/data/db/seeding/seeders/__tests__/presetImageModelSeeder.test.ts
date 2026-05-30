import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { PresetImageModelSeeder } from '@data/db/seeding/seeders/presetImageModelSeeder'
import { modelService } from '@data/services/ModelService'
import { providerRegistryService } from '@data/services/ProviderRegistryService'
import { generateOrderKeyBetween } from '@data/services/utils/orderKey'
import { createUniqueModelId, type Model, MODEL_CAPABILITY } from '@shared/data/types/model'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@cherrystudio/provider-registry/node', () => {
  class RegistryLoader {
    getModelsVersion() {
      return 'models-test-version'
    }
    getProviderModelsVersion() {
      return 'provider-models-test-version'
    }
  }
  return { RegistryLoader }
})

vi.mock('@data/services/ProviderRegistryService', () => ({
  providerRegistryService: {
    listProviderRegistryModels: vi.fn()
  }
}))

const listProviderRegistryModelsMock = vi.mocked(providerRegistryService.listProviderRegistryModels)

function providerRow(providerId: string, name = providerId) {
  return { providerId, name, orderKey: generateOrderKeyBetween(null, null) }
}

function activeImageModel(input: { providerId: string; modelId: string; presetModelId: string; name?: string }): Model {
  return {
    id: createUniqueModelId(input.providerId, input.presetModelId),
    providerId: input.providerId,
    apiModelId: input.modelId,
    presetModelId: input.presetModelId,
    name: input.name ?? input.presetModelId,
    capabilities: [MODEL_CAPABILITY.IMAGE_GENERATION],
    supportsStreaming: true,
    isEnabled: true,
    isHidden: false
  }
}

describe('PresetImageModelSeeder', () => {
  const dbh = setupTestDatabase()

  beforeEach(() => {
    vi.clearAllMocks()
    listProviderRegistryModelsMock.mockResolvedValue([])
  })

  it('inserts active registry image models using provider API id and canonical preset id', async () => {
    await dbh.db.insert(userProviderTable).values([providerRow('silicon', 'Silicon')])
    listProviderRegistryModelsMock.mockImplementation(async (options) =>
      options?.disabled
        ? []
        : [
            activeImageModel({
              providerId: 'silicon',
              modelId: 'Qwen/Qwen-Image',
              presetModelId: 'qwen-image',
              name: 'Qwen Image'
            })
          ]
    )

    await new PresetImageModelSeeder().run(dbh.db)

    const [row] = await dbh.db.select().from(userModelTable)
    expect(row).toMatchObject({
      id: 'silicon::Qwen/Qwen-Image',
      providerId: 'silicon',
      modelId: 'Qwen/Qwen-Image',
      presetModelId: 'qwen-image',
      name: 'Qwen Image',
      capabilities: [MODEL_CAPABILITY.IMAGE_GENERATION],
      isDeprecated: false
    })
  })

  it('does not overwrite existing user fields while clearing stale active deprecation', async () => {
    await dbh.db.insert(userProviderTable).values([providerRow('silicon', 'Silicon')])
    await dbh.db.insert(userModelTable).values({
      id: 'silicon::Qwen/Qwen-Image',
      providerId: 'silicon',
      modelId: 'Qwen/Qwen-Image',
      presetModelId: 'qwen-image',
      name: 'User Name',
      capabilities: [MODEL_CAPABILITY.IMAGE_GENERATION],
      supportsStreaming: true,
      isEnabled: false,
      isHidden: true,
      isDeprecated: true,
      userOverrides: ['name'],
      orderKey: generateOrderKeyBetween(null, null)
    })
    listProviderRegistryModelsMock.mockImplementation(async (options) =>
      options?.disabled
        ? []
        : [
            activeImageModel({
              providerId: 'silicon',
              modelId: 'Qwen/Qwen-Image',
              presetModelId: 'qwen-image',
              name: 'Registry Name'
            })
          ]
    )

    await new PresetImageModelSeeder().run(dbh.db)

    const [row] = await dbh.db.select().from(userModelTable)
    expect(row).toMatchObject({
      name: 'User Name',
      isEnabled: false,
      isHidden: true,
      isDeprecated: false,
      userOverrides: ['name']
    })
  })

  it('marks explicitly disabled registry image rows deprecated', async () => {
    const modelId = 'silicon::Qwen/Qwen-Image'
    await dbh.db.insert(userProviderTable).values([providerRow('silicon', 'Silicon')])
    await dbh.db.insert(userModelTable).values({
      id: modelId,
      providerId: 'silicon',
      modelId: 'Qwen/Qwen-Image',
      presetModelId: 'qwen-image',
      name: 'Qwen Image',
      capabilities: [MODEL_CAPABILITY.IMAGE_GENERATION],
      supportsStreaming: true,
      isEnabled: true,
      isHidden: false,
      isDeprecated: false,
      orderKey: generateOrderKeyBetween(null, null)
    })
    listProviderRegistryModelsMock.mockImplementation(async (options) =>
      options?.disabled
        ? [
            activeImageModel({
              providerId: 'silicon',
              modelId: 'Qwen/Qwen-Image',
              presetModelId: 'qwen-image',
              name: 'Qwen Image'
            })
          ]
        : []
    )

    await new PresetImageModelSeeder().run(dbh.db)

    const [row] = await dbh.db.select().from(userModelTable).where(eq(userModelTable.id, modelId))
    expect(row.isDeprecated).toBe(true)
  })

  it('exposes seeded image models through the model list used by painting catalog', async () => {
    await dbh.db.insert(userProviderTable).values([providerRow('ppio', 'PPIO')])
    listProviderRegistryModelsMock.mockImplementation(async (options) =>
      options?.disabled
        ? []
        : [
            activeImageModel({
              providerId: 'ppio',
              modelId: 'seedream-4.5',
              presetModelId: 'seedream-4.5',
              name: 'Seedream 4.5'
            })
          ]
    )

    await new PresetImageModelSeeder().run(dbh.db)

    const models = await modelService.list({
      providerId: 'ppio',
      capability: MODEL_CAPABILITY.IMAGE_GENERATION
    })
    expect(models.map((model) => model.id)).toEqual(['ppio::seedream-4.5'])
  })
})
