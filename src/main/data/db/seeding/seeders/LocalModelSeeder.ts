import { eq } from 'drizzle-orm'

import type { InsertUserModelRow } from '@data/db/schemas/userModel'
import { userModelTable } from '@data/db/schemas/userModel'
import type { InsertUserProviderRow } from '@data/db/schemas/userProvider'
import { providerService } from '@data/services/ProviderService'
import { insertManyWithOrderKey } from '@data/services/utils/orderKey'
import {
  LOCAL_EMBEDDING_MODELS,
  LOCAL_EMBEDDING_PROVIDER_ID,
  LOCAL_EMBEDDING_PROVIDER_NAME,
  type LocalEmbeddingModelPreset
} from '@shared/data/presets/localEmbedding'
import { MODEL_CAPABILITY, type ModelCapability } from '@shared/data/types/model'

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
    providerSettings: null,
    isEnabled: true
  }
}

function createLocalEmbeddingModelRow(preset: LocalEmbeddingModelPreset): LocalEmbeddingModelRow {
  return {
    id: preset.uniqueModelId,
    providerId: LOCAL_EMBEDDING_PROVIDER_ID,
    modelId: preset.modelId,
    presetModelId: null,
    name: preset.name,
    description: null,
    group: preset.group,
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

function createLocalEmbeddingModelRows(): LocalEmbeddingModelRow[] {
  return LOCAL_EMBEDDING_MODELS.map((preset) => createLocalEmbeddingModelRow(preset))
}

export class LocalModelSeeder implements ISeeder {
  readonly name = 'localModel'
  readonly description = 'Ensure built-in local model provider and catalog entries'
  readonly version: string

  constructor() {
    this.version = hashObject({
      provider: createLocalEmbeddingProviderRow(),
      models: createLocalEmbeddingModelRows()
    })
  }

  run(db: DbType): void {
    db.transaction((tx) => {
      providerService.batchUpsertTx(tx, [createLocalEmbeddingProviderRow()])

      const rows = createLocalEmbeddingModelRows()
      const existingIds = new Set(
        tx
          .select({ id: userModelTable.id })
          .from(userModelTable)
          .where(eq(userModelTable.providerId, LOCAL_EMBEDDING_PROVIDER_ID))
          .all()
          .map((row) => row.id)
      )
      // Refresh builtin names so a renamed preset propagates to existing installs.
      for (const row of rows) {
        if (existingIds.has(row.id)) {
          tx.update(userModelTable).set({ name: row.name }).where(eq(userModelTable.id, row.id)).run()
        }
      }

      const missing = rows.filter((row) => !existingIds.has(row.id))
      if (missing.length === 0) return

      insertManyWithOrderKey(tx, userModelTable, missing, {
        pkColumn: userModelTable.id,
        scope: eq(userModelTable.providerId, LOCAL_EMBEDDING_PROVIDER_ID)
      })
    })
  }
}
