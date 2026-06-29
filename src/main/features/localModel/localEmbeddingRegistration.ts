import { application } from '@application'
import { knowledgeBaseTable } from '@data/db/schemas/knowledge'
import type { InsertUserModelRow } from '@data/db/schemas/userModel'
import { userModelTable } from '@data/db/schemas/userModel'
import type { InsertUserProviderRow } from '@data/db/schemas/userProvider'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { providerService } from '@data/services/ProviderService'
import { insertManyWithOrderKey } from '@data/services/utils/orderKey'
import { loggerService } from '@logger'
import {
  LOCAL_EMBEDDING_MODEL_GROUP,
  LOCAL_EMBEDDING_MODEL_ID,
  LOCAL_EMBEDDING_MODEL_NAME,
  LOCAL_EMBEDDING_PROVIDER_ID,
  LOCAL_EMBEDDING_PROVIDER_NAME,
  LOCAL_EMBEDDING_UNIQUE_MODEL_ID
} from '@shared/data/presets/localEmbedding'
import { MODEL_CAPABILITY, type ModelCapability } from '@shared/data/types/model'
import { eq } from 'drizzle-orm'

/**
 * The optional local embedding model is registered into `user_provider` /
 * `user_model` only when its weights are downloaded (via the settings card),
 * and unregistered on removal — so the KB embedding picker lists it exactly
 * when it is usable. (The AI SDK *provider factory* is always available via the
 * extension registry; these rows only drive picker visibility and DB-backed
 * model resolution.)
 */

const logger = loggerService.withContext('LocalEmbeddingRegistration')

type LocalEmbeddingProviderRow = Omit<InsertUserProviderRow, 'orderKey'>
type LocalEmbeddingModelRow = Omit<InsertUserModelRow, 'orderKey'>

function createLocalEmbeddingProviderRow(): LocalEmbeddingProviderRow {
  return {
    providerId: LOCAL_EMBEDDING_PROVIDER_ID,
    presetProviderId: LOCAL_EMBEDDING_PROVIDER_ID,
    name: LOCAL_EMBEDDING_PROVIDER_NAME,
    // In-process runtime — no HTTP endpoints / auth.
    endpointConfigs: {},
    defaultChatEndpoint: null,
    authConfig: null,
    apiFeatures: null,
    providerSettings: null,
    isEnabled: true
  }
}

function createLocalEmbeddingModelRow(): LocalEmbeddingModelRow {
  return {
    id: LOCAL_EMBEDDING_UNIQUE_MODEL_ID,
    providerId: LOCAL_EMBEDDING_PROVIDER_ID,
    modelId: LOCAL_EMBEDDING_MODEL_ID,
    presetModelId: null,
    name: LOCAL_EMBEDDING_MODEL_NAME,
    description: null,
    group: LOCAL_EMBEDDING_MODEL_GROUP,
    capabilities: [MODEL_CAPABILITY.EMBEDDING] as ModelCapability[],
    inputModalities: null,
    outputModalities: null,
    endpointTypes: null,
    customEndpointUrl: null,
    contextWindow: null,
    maxInputTokens: null,
    maxOutputTokens: null,
    supportsStreaming: false,
    reasoning: null,
    parameters: null,
    pricing: null,
    isEnabled: true,
    // Hidden from general model lists; the KB embedding picker still shows it.
    isHidden: true,
    isDeprecated: false,
    notes: null,
    userOverrides: null
  }
}

/**
 * Idempotently insert the local embedding provider + model rows. Safe to call
 * on every successful download — re-running upserts the provider and skips the
 * model if its row already exists.
 */
export async function registerLocalEmbeddingModel(): Promise<void> {
  await application.get('DbService').withWriteTx(async (tx) => {
    const insertedProviderCount = await providerService.batchUpsertTx(tx, [createLocalEmbeddingProviderRow()])
    if (insertedProviderCount > 0) {
      logger.info('Registered local embedding provider', { providerId: LOCAL_EMBEDDING_PROVIDER_ID })
    }

    const [existing] = await tx
      .select({ id: userModelTable.id })
      .from(userModelTable)
      .where(eq(userModelTable.id, LOCAL_EMBEDDING_UNIQUE_MODEL_ID))
      .limit(1)
    if (existing) return

    await insertManyWithOrderKey(tx, userModelTable, [createLocalEmbeddingModelRow()], {
      pkColumn: userModelTable.id,
      scope: eq(userModelTable.providerId, LOCAL_EMBEDDING_PROVIDER_ID)
    })
    logger.info('Registered local embedding model', { modelId: LOCAL_EMBEDDING_UNIQUE_MODEL_ID })
  })
}

/**
 * Remove the local embedding provider + model rows — but only when no knowledge
 * base still references the model. `knowledge_base.embeddingModelId` is the one
 * RESTRICT FK onto `user_model` (every other reference is ON DELETE SET NULL),
 * so a base using it would both block the delete and lose its embeddings. In
 * that case we leave the rows in place (harmless — the row simply outlives the
 * weights, exactly as the seeded row used to). Deleting the provider row
 * cascades to the model row.
 *
 * @returns whether the rows were removed.
 */
export async function unregisterLocalEmbeddingModelIfUnused(): Promise<{ removed: boolean }> {
  return application.get('DbService').withWriteTx(async (tx) => {
    const [inUse] = await tx
      .select({ id: knowledgeBaseTable.id })
      .from(knowledgeBaseTable)
      .where(eq(knowledgeBaseTable.embeddingModelId, LOCAL_EMBEDDING_UNIQUE_MODEL_ID))
      .limit(1)
    if (inUse) {
      logger.info('Kept local embedding registration — still used by a knowledge base')
      return { removed: false }
    }

    await tx.delete(userProviderTable).where(eq(userProviderTable.providerId, LOCAL_EMBEDDING_PROVIDER_ID))
    logger.info('Unregistered local embedding provider/model')
    return { removed: true }
  })
}
