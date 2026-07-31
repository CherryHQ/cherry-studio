import type { InsertUserModelRow } from '@data/db/schemas/userModel'
import { userModelTable } from '@data/db/schemas/userModel'
import type { InsertUserProviderRow } from '@data/db/schemas/userProvider'
import { providerService } from '@data/services/ProviderService'
import { insertManyWithOrderKey } from '@data/services/utils/orderKey'
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

type LocalEmbeddingProviderRow = Omit<InsertUserProviderRow, 'orderKey'>
type LocalEmbeddingModelRow = Omit<InsertUserModelRow, 'orderKey'>

function createLocalEmbeddingProviderRow(): LocalEmbeddingProviderRow {
  return {
    providerId: LOCAL_EMBEDDING_PROVIDER_ID,
    presetProviderId: LOCAL_EMBEDDING_PROVIDER_ID,
    name: LOCAL_EMBEDDING_PROVIDER_NAME,
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
    contextWindow: null,
    maxInputTokens: null,
    maxOutputTokens: null,
    supportsStreaming: false,
    reasoning: null,
    parameters: null,
    pricing: null,
    isEnabled: true,
    isHidden: false,
    isDeprecated: false,
    notes: null
  }
}

export class LocalModelSeeder implements ISeeder {
  readonly name = 'localModel'
  readonly description = 'Ensure built-in local model provider and catalog entries'
  readonly version: string

  constructor() {
    this.version = hashObject({
      provider: createLocalEmbeddingProviderRow(),
      model: createLocalEmbeddingModelRow()
    })
  }

  run(db: DbType): void {
    db.transaction((tx) => {
      providerService.batchUpsertTx(tx, [createLocalEmbeddingProviderRow()])

      const [existing] = tx
        .select({ id: userModelTable.id })
        .from(userModelTable)
        .where(eq(userModelTable.id, LOCAL_EMBEDDING_UNIQUE_MODEL_ID))
        .limit(1)
        .all()
      if (existing) {
        tx.update(userModelTable)
          .set({ name: LOCAL_EMBEDDING_MODEL_NAME })
          .where(eq(userModelTable.id, LOCAL_EMBEDDING_UNIQUE_MODEL_ID))
          .run()
        return
      }

      insertManyWithOrderKey(tx, userModelTable, [createLocalEmbeddingModelRow()], {
        pkColumn: userModelTable.id,
        scope: eq(userModelTable.providerId, LOCAL_EMBEDDING_PROVIDER_ID)
      })
    })
  }
}
