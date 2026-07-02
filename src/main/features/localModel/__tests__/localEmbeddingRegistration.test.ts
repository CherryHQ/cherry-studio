import { knowledgeBaseTable } from '@data/db/schemas/knowledge'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
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

import { registerLocalEmbeddingModel, unregisterLocalEmbeddingModelIfUnused } from '../localEmbeddingRegistration'

describe('localEmbeddingRegistration', () => {
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

  async function insertBaseUsingModel() {
    await dbh.db.insert(knowledgeBaseTable).values({
      id: 'kb-local-embed',
      name: 'KB',
      status: 'completed',
      embeddingModelId: LOCAL_EMBEDDING_UNIQUE_MODEL_ID,
      dimensions: 1024,
      error: null,
      chunkSize: 1000,
      chunkOverlap: 200,
      searchMode: 'vector'
    })
  }

  describe('registerLocalEmbeddingModel', () => {
    it('inserts the provider and a hidden embedding model', async () => {
      await registerLocalEmbeddingModel()

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

      await registerLocalEmbeddingModel()
      await registerLocalEmbeddingModel()

      expect((await readProvider())?.name).toBe('Renamed Local')
      const models = await dbh.db
        .select()
        .from(userModelTable)
        .where(eq(userModelTable.providerId, LOCAL_EMBEDDING_PROVIDER_ID))
      expect(models).toHaveLength(1)
    })
  })

  describe('unregisterLocalEmbeddingModelIfUnused', () => {
    it('removes the provider and model when no knowledge base uses them', async () => {
      await registerLocalEmbeddingModel()

      const result = await unregisterLocalEmbeddingModelIfUnused()

      expect(result.removed).toBe(true)
      expect(await readProvider()).toBeUndefined()
      // Deleting the provider row cascades to the model row.
      expect(await readModel()).toBeUndefined()
    })

    it('keeps the rows when a knowledge base still references the model', async () => {
      await registerLocalEmbeddingModel()
      await insertBaseUsingModel()

      const result = await unregisterLocalEmbeddingModelIfUnused()

      expect(result.removed).toBe(false)
      expect(await readProvider()).toBeDefined()
      expect(await readModel()).toBeDefined()
    })
  })
})
