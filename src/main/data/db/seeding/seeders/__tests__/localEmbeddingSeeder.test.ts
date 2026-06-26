import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { LocalEmbeddingSeeder } from '@data/db/seeding/seeders/localEmbeddingSeeder'
import { generateOrderKeyBetween } from '@data/services/utils/orderKey'
import {
  LOCAL_EMBEDDING_MODEL_ID,
  LOCAL_EMBEDDING_MODEL_NAME,
  LOCAL_EMBEDDING_PROVIDER_ID,
  LOCAL_EMBEDDING_PROVIDER_NAME,
  LOCAL_EMBEDDING_UNIQUE_MODEL_ID
} from '@shared/data/presets/localEmbedding'
import { MODEL_CAPABILITY } from '@shared/data/types/model'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

describe('LocalEmbeddingSeeder', () => {
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

  it('seeds the local embedding provider and a hidden embedding model', async () => {
    await new LocalEmbeddingSeeder().run(dbh.db)

    expect(await readProvider()).toMatchObject({
      providerId: LOCAL_EMBEDDING_PROVIDER_ID,
      presetProviderId: LOCAL_EMBEDDING_PROVIDER_ID,
      name: LOCAL_EMBEDDING_PROVIDER_NAME,
      defaultChatEndpoint: null,
      authConfig: null,
      isEnabled: true
    })

    const model = await readModel()
    expect(model).toMatchObject({
      id: LOCAL_EMBEDDING_UNIQUE_MODEL_ID,
      providerId: LOCAL_EMBEDDING_PROVIDER_ID,
      modelId: LOCAL_EMBEDDING_MODEL_ID,
      name: LOCAL_EMBEDDING_MODEL_NAME,
      isEnabled: true,
      isHidden: true,
      supportsStreaming: false
    })
    expect(model?.capabilities).toContain(MODEL_CAPABILITY.EMBEDDING)
  })

  it('is idempotent and preserves an existing renamed provider row', async () => {
    await dbh.db.insert(userProviderTable).values({
      providerId: LOCAL_EMBEDDING_PROVIDER_ID,
      presetProviderId: LOCAL_EMBEDDING_PROVIDER_ID,
      name: 'Renamed Local',
      orderKey: generateOrderKeyBetween(null, null)
    })

    await new LocalEmbeddingSeeder().run(dbh.db)
    await new LocalEmbeddingSeeder().run(dbh.db)

    expect((await readProvider())?.name).toBe('Renamed Local')
    const models = await dbh.db
      .select()
      .from(userModelTable)
      .where(eq(userModelTable.providerId, LOCAL_EMBEDDING_PROVIDER_ID))
    expect(models).toHaveLength(1)
  })
})
