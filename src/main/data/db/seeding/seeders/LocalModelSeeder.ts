import { eq, inArray } from 'drizzle-orm'

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
import {
  LOCAL_LLM_MODELS,
  LOCAL_LLM_PROVIDER_ID,
  LOCAL_LLM_PROVIDER_NAME,
  type LocalLlmModel,
  localLlmUniqueModelId
} from '@shared/data/presets/localLlm'
import { MODEL_CAPABILITY, type ModelCapability } from '@shared/data/types/model'

import type { DbType, ISeeder } from '../../types'
import { hashObject } from '../hashObject'

type LocalProviderRow = Omit<InsertUserProviderRow, 'orderKey'>
type LocalModelRow = Omit<InsertUserModelRow, 'orderKey'> & { id: string; name: string }

function createLocalEmbeddingProviderRow(): LocalProviderRow {
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

function createLocalEmbeddingModelRow(): LocalModelRow {
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

function createLocalLlmProviderRow(): LocalProviderRow {
  return {
    ...createLocalEmbeddingProviderRow(),
    providerId: LOCAL_LLM_PROVIDER_ID,
    presetProviderId: LOCAL_LLM_PROVIDER_ID,
    name: LOCAL_LLM_PROVIDER_NAME
  }
}

/** Disabled until the model is installed; `syncInstallState` in the llm capability hooks enables it. */
function createLocalLlmModelRow(model: LocalLlmModel): LocalModelRow {
  return {
    ...createLocalEmbeddingModelRow(),
    id: localLlmUniqueModelId(model.bundleId),
    providerId: LOCAL_LLM_PROVIDER_ID,
    modelId: model.bundleId,
    name: model.name,
    group: model.group,
    capabilities: [MODEL_CAPABILITY.FUNCTION_CALL, MODEL_CAPABILITY.REASONING],
    // Off by default: Qwen3.5 reasons for thousands of tokens even on simple prompts.
    reasoning: { controls: [{ kind: 'toggle', default: false }] },
    contextWindow: model.contextWindow,
    supportsStreaming: true,
    isEnabled: false
  }
}

const LOCAL_PROVIDERS = (): Array<{ provider: LocalProviderRow; models: LocalModelRow[] }> => [
  { provider: createLocalEmbeddingProviderRow(), models: [createLocalEmbeddingModelRow()] },
  { provider: createLocalLlmProviderRow(), models: LOCAL_LLM_MODELS.map(createLocalLlmModelRow) }
]

export class LocalModelSeeder implements ISeeder {
  readonly name = 'localModel'
  readonly description = 'Ensure built-in local model provider and catalog entries'
  readonly version: string

  constructor() {
    this.version = hashObject(LOCAL_PROVIDERS())
  }

  run(db: DbType): void {
    db.transaction((tx) => {
      for (const { provider, models } of LOCAL_PROVIDERS()) {
        providerService.batchUpsertTx(tx, [provider])

        // Existing rows keep their user-owned state (enabled, order); built-in descriptions are refreshed.
        const existing = new Set(
          tx
            .select({ id: userModelTable.id })
            .from(userModelTable)
            .where(
              inArray(
                userModelTable.id,
                models.map((model) => model.id)
              )
            )
            .all()
            .map((row) => row.id)
        )
        for (const model of models.filter((row) => existing.has(row.id))) {
          tx.update(userModelTable)
            .set({
              name: model.name,
              capabilities: model.capabilities,
              reasoning: model.reasoning,
              contextWindow: model.contextWindow
            })
            .where(eq(userModelTable.id, model.id))
            .run()
        }

        const missing = models.filter((row) => !existing.has(row.id))
        if (missing.length === 0) continue
        insertManyWithOrderKey(tx, userModelTable, missing, {
          pkColumn: userModelTable.id,
          scope: eq(userModelTable.providerId, provider.providerId)
        })
      }
    })
  }
}
