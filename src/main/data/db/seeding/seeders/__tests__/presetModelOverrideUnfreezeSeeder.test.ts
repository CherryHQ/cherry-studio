import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { PresetModelOverrideUnfreezeSeeder } from '@data/db/seeding/seeders/presetModelOverrideUnfreezeSeeder'
import { MODEL_CAPABILITY } from '@shared/data/types/model'
import { setupTestDatabase } from '@test-helpers/db'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@cherrystudio/provider-registry/node', () => {
  class RegistryLoader {
    findProvider(id: string) {
      return id === 'openai' ? { id: 'openai' } : null
    }
    findOverride() {
      return null
    }
    findModel(id: string) {
      return id !== 'unknown'
        ? {
            id: 'gpt-4o',
            name: 'GPT-4o',
            capabilities: [MODEL_CAPABILITY.FUNCTION_CALL, MODEL_CAPABILITY.TEXT_GENERATION],
            inputModalities: ['text', 'image'],
            contextWindow: 128_000
          }
        : null
    }
  }
  return { RegistryLoader }
})

describe('PresetModelOverrideUnfreezeSeeder', () => {
  const dbh = setupTestDatabase()

  async function seed(rows: Array<Partial<typeof userModelTable.$inferInsert> & { modelId: string }>) {
    const now = Date.now()
    await dbh.db.insert(userProviderTable).values([
      {
        providerId: 'openai',
        presetProviderId: 'openai',
        name: 'OpenAI',
        orderKey: 'a0',
        createdAt: now,
        updatedAt: now
      },
      { providerId: 'relay', presetProviderId: null, name: 'Relay', orderKey: 'a1', createdAt: now, updatedAt: now }
    ])
    await dbh.db.insert(userModelTable).values(
      rows.map((row, index) => ({
        id: `${row.providerId ?? 'openai'}::${row.modelId}`,
        providerId: 'openai',
        presetModelId: 'gpt-4o',
        orderKey: `b${index}`,
        createdAt: now,
        updatedAt: now,
        ...row
      }))
    )
  }

  async function read(id: string) {
    return (await dbh.db.select().from(userModelTable)).find((row) => row.id === id)!
  }

  it('hands a delta equal to the registry back, list order aside, and keeps a real override', async () => {
    await seed([
      {
        modelId: 'frozen',
        name: 'GPT-4o',
        capabilities: [MODEL_CAPABILITY.TEXT_GENERATION, MODEL_CAPABILITY.FUNCTION_CALL],
        inputModalities: ['image', 'text'],
        contextWindow: 128_000,
        supportsStreaming: true
      },
      {
        modelId: 'chosen',
        name: 'My GPT-4o',
        capabilities: [MODEL_CAPABILITY.TEXT_GENERATION],
        inputModalities: [],
        contextWindow: 64_000,
        supportsStreaming: false
      }
    ])

    new PresetModelOverrideUnfreezeSeeder().run(dbh.db)

    expect(await read('openai::frozen')).toMatchObject({
      name: null,
      capabilities: null,
      inputModalities: null,
      contextWindow: null,
      supportsStreaming: null
    })
    expect(await read('openai::chosen')).toMatchObject({
      name: 'My GPT-4o',
      capabilities: [MODEL_CAPABILITY.TEXT_GENERATION],
      inputModalities: [],
      contextWindow: 64_000,
      supportsStreaming: false
    })
  })

  it('leaves custom rows and rows without a registry entry alone', async () => {
    await seed([
      {
        modelId: 'gpt-4o',
        providerId: 'relay',
        presetModelId: null,
        name: 'GPT-4o',
        capabilities: [MODEL_CAPABILITY.TEXT_GENERATION],
        supportsStreaming: true
      },
      {
        modelId: 'unknown',
        presetModelId: 'unknown',
        name: 'Unknown',
        capabilities: [MODEL_CAPABILITY.TEXT_GENERATION]
      }
    ])

    new PresetModelOverrideUnfreezeSeeder().run(dbh.db)

    expect(await read('relay::gpt-4o')).toMatchObject({
      name: 'GPT-4o',
      capabilities: [MODEL_CAPABILITY.TEXT_GENERATION]
    })
    expect(await read('openai::unknown')).toMatchObject({
      name: 'Unknown',
      capabilities: [MODEL_CAPABILITY.TEXT_GENERATION]
    })
  })
})
