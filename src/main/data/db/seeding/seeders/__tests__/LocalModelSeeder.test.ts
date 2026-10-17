import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { LocalModelSeeder } from '@data/db/seeding/seeders/LocalModelSeeder'
import {
  LOCAL_EMBEDDING_MODEL_ID,
  LOCAL_EMBEDDING_MODEL_NAME,
  LOCAL_EMBEDDING_PROVIDER_ID,
  LOCAL_EMBEDDING_PROVIDER_NAME,
  LOCAL_EMBEDDING_UNIQUE_MODEL_ID
} from '@shared/data/presets/localEmbedding'
import { LOCAL_LLM_PROVIDER_ID, localLlmUniqueModelId } from '@shared/data/presets/localLlm'
import { MODEL_CAPABILITY } from '@shared/data/types/model'

describe('LocalModelSeeder', () => {
  const dbh = setupTestDatabase()

  function readProvider() {
    return dbh.db
      .select()
      .from(userProviderTable)
      .where(eq(userProviderTable.providerId, LOCAL_EMBEDDING_PROVIDER_ID))
      .limit(1)
      .then((rows) => rows[0])
  }

  function readModel() {
    return dbh.db
      .select()
      .from(userModelTable)
      .where(eq(userModelTable.id, LOCAL_EMBEDDING_UNIQUE_MODEL_ID))
      .limit(1)
      .then((rows) => rows[0])
  }

  it('seeds the enabled local embedding provider and visible Qwen model', async () => {
    new LocalModelSeeder().run(dbh.db)

    expect(await readProvider()).toMatchObject({
      providerId: LOCAL_EMBEDDING_PROVIDER_ID,
      presetProviderId: LOCAL_EMBEDDING_PROVIDER_ID,
      name: LOCAL_EMBEDDING_PROVIDER_NAME,
      isEnabled: true
    })

    const model = await readModel()
    expect(model).toMatchObject({
      id: LOCAL_EMBEDDING_UNIQUE_MODEL_ID,
      providerId: LOCAL_EMBEDDING_PROVIDER_ID,
      modelId: LOCAL_EMBEDDING_MODEL_ID,
      name: LOCAL_EMBEDDING_MODEL_NAME,
      isEnabled: true,
      isHidden: false,
      supportsStreaming: false
    })
    expect(model?.capabilities).toContain(MODEL_CAPABILITY.EMBEDDING)
  })

  it('is idempotent, preserves provider values, and refreshes the built-in model name', async () => {
    const seeder = new LocalModelSeeder()
    seeder.run(dbh.db)
    await dbh.db
      .update(userProviderTable)
      .set({ name: 'Existing Local Provider' })
      .where(eq(userProviderTable.providerId, LOCAL_EMBEDDING_PROVIDER_ID))
    await dbh.db
      .update(userModelTable)
      .set({ name: 'Existing Local Model' })
      .where(eq(userModelTable.id, LOCAL_EMBEDDING_UNIQUE_MODEL_ID))

    seeder.run(dbh.db)

    expect((await readProvider())?.name).toBe('Existing Local Provider')
    expect((await readModel())?.name).toBe(LOCAL_EMBEDDING_MODEL_NAME)
    const models = await dbh.db
      .select()
      .from(userModelTable)
      .where(eq(userModelTable.providerId, LOCAL_EMBEDDING_PROVIDER_ID))
    expect(models).toHaveLength(1)
  })

  it('lists local chat models disabled until they are installed', async () => {
    new LocalModelSeeder().run(dbh.db)

    const [model] = await dbh.db
      .select()
      .from(userModelTable)
      .where(eq(userModelTable.id, localLlmUniqueModelId('qwen3.5-4b-q4_k_m')))
    expect(model).toMatchObject({ providerId: LOCAL_LLM_PROVIDER_ID, isEnabled: false, supportsStreaming: true })
  })

  it('keeps an installed local chat model enabled when it seeds again', async () => {
    const seeder = new LocalModelSeeder()
    seeder.run(dbh.db)
    const id = localLlmUniqueModelId('qwen3.5-4b-q4_k_m')
    await dbh.db.update(userModelTable).set({ isEnabled: true }).where(eq(userModelTable.id, id))

    seeder.run(dbh.db)

    const [model] = await dbh.db.select().from(userModelTable).where(eq(userModelTable.id, id))
    expect(model.isEnabled).toBe(true)
  })

  it('gives a chat model row from an earlier release the current tool support, reasoning toggle and context window', async () => {
    const seeder = new LocalModelSeeder()
    seeder.run(dbh.db)
    const id = localLlmUniqueModelId('qwen3.5-4b-q4_k_m')
    await dbh.db
      .update(userModelTable)
      .set({ capabilities: [], reasoning: null, contextWindow: 32_768 })
      .where(eq(userModelTable.id, id))

    seeder.run(dbh.db)

    const [model] = await dbh.db.select().from(userModelTable).where(eq(userModelTable.id, id))
    expect(model.capabilities).toEqual(
      expect.arrayContaining([MODEL_CAPABILITY.FUNCTION_CALL, MODEL_CAPABILITY.REASONING])
    )
    expect(model.reasoning).toEqual({ controls: [{ kind: 'toggle', default: false }] })
    expect(model.contextWindow).toBe(65_536)
  })
})
