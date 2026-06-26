import type { InsertUserModelRow } from '@data/db/schemas/userModel'
import { userModelTable } from '@data/db/schemas/userModel'
import type { InsertUserProviderRow } from '@data/db/schemas/userProvider'
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

import type { DbType, ISeeder } from '../../types'
import { hashObject } from '../hashObject'

const logger = loggerService.withContext('LocalEmbeddingSeeder')

type TxLike = Pick<DbType, 'select' | 'insert' | 'update'>
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

async function ensureLocalEmbeddingProviderAndModelTx(tx: TxLike): Promise<void> {
  const insertedProviderCount = await providerService.batchUpsertTx(tx, [createLocalEmbeddingProviderRow()])
  if (insertedProviderCount > 0) {
    logger.info('Seeded local embedding provider', { providerId: LOCAL_EMBEDDING_PROVIDER_ID })
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
  logger.info('Seeded local embedding model', { modelId: LOCAL_EMBEDDING_UNIQUE_MODEL_ID })
}

export class LocalEmbeddingSeeder implements ISeeder {
  readonly name = 'localEmbedding'
  readonly description = 'Insert the optional local (transformers.js) embedding provider and model'
  readonly version: string

  constructor() {
    this.version = hashObject({
      provider: createLocalEmbeddingProviderRow(),
      model: createLocalEmbeddingModelRow()
    })
  }

  async run(db: DbType): Promise<void> {
    await db.transaction((tx) => ensureLocalEmbeddingProviderAndModelTx(tx))
  }
}
