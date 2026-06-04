import { ENDPOINT_TYPE } from '@cherrystudio/provider-registry'
import { preferenceTable } from '@data/db/schemas/preference'
import type { NewUserModel } from '@data/db/schemas/userModel'
import { userModelTable } from '@data/db/schemas/userModel'
import type { NewUserProvider } from '@data/db/schemas/userProvider'
import type { DbType } from '@data/db/types'
import { providerService } from '@data/services/ProviderService'
import { insertManyWithOrderKey } from '@data/services/utils/orderKey'
import {
  CHERRYAI_API_BASE_URL,
  CHERRYAI_DEFAULT_MODEL_GROUP,
  CHERRYAI_DEFAULT_MODEL_ID,
  CHERRYAI_DEFAULT_MODEL_NAME,
  CHERRYAI_DEFAULT_UNIQUE_MODEL_ID,
  CHERRYAI_PROVIDER_ID,
  CHERRYAI_PROVIDER_NAME
} from '@shared/data/presets/cherryai'
import { and, eq } from 'drizzle-orm'

export const CHAT_DEFAULT_MODEL_PREFERENCE_SCOPE = 'default'
export const CHAT_DEFAULT_MODEL_PREFERENCE_KEY = 'chat.default_model_id'

export function createCherryAIProviderRow() {
  return {
    providerId: CHERRYAI_PROVIDER_ID,
    presetProviderId: CHERRYAI_PROVIDER_ID,
    name: CHERRYAI_PROVIDER_NAME,
    endpointConfigs: {
      [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: {
        baseUrl: CHERRYAI_API_BASE_URL
      }
    },
    defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
    authConfig: null,
    apiFeatures: null
  } satisfies Omit<NewUserProvider, 'orderKey'>
}

export function createCherryAIDefaultModelRow() {
  return {
    id: CHERRYAI_DEFAULT_UNIQUE_MODEL_ID,
    providerId: CHERRYAI_PROVIDER_ID,
    modelId: CHERRYAI_DEFAULT_MODEL_ID,
    name: CHERRYAI_DEFAULT_MODEL_NAME,
    group: CHERRYAI_DEFAULT_MODEL_GROUP,
    capabilities: [],
    supportsStreaming: true,
    isEnabled: true,
    isHidden: false,
    isDeprecated: false
  } satisfies Omit<NewUserModel, 'orderKey'>
}

export async function ensureCherryAIDefaultProviderAndModelTx(tx: Pick<DbType, 'select' | 'insert'>): Promise<{
  insertedProviderCount: number
  insertedModelCount: number
}> {
  const insertedProviderCount = await providerService.batchUpsertTx(tx, [createCherryAIProviderRow()])
  const insertedModelCount = await insertCherryAIDefaultModelIfMissingTx(tx)

  return { insertedProviderCount, insertedModelCount }
}

export async function ensureDefaultChatModelPreferenceTx(
  tx: Pick<DbType, 'select' | 'insert' | 'update'>
): Promise<void> {
  const [existing] = await tx
    .select({ value: preferenceTable.value })
    .from(preferenceTable)
    .where(
      and(
        eq(preferenceTable.scope, CHAT_DEFAULT_MODEL_PREFERENCE_SCOPE),
        eq(preferenceTable.key, CHAT_DEFAULT_MODEL_PREFERENCE_KEY)
      )
    )
    .limit(1)

  if (existing && existing.value !== null && existing.value !== '') return

  if (!existing) {
    await tx.insert(preferenceTable).values({
      scope: CHAT_DEFAULT_MODEL_PREFERENCE_SCOPE,
      key: CHAT_DEFAULT_MODEL_PREFERENCE_KEY,
      value: CHERRYAI_DEFAULT_UNIQUE_MODEL_ID
    })
    return
  }

  await tx
    .update(preferenceTable)
    .set({
      value: CHERRYAI_DEFAULT_UNIQUE_MODEL_ID,
      updatedAt: Date.now()
    })
    .where(
      and(
        eq(preferenceTable.scope, CHAT_DEFAULT_MODEL_PREFERENCE_SCOPE),
        eq(preferenceTable.key, CHAT_DEFAULT_MODEL_PREFERENCE_KEY)
      )
    )
}

async function insertCherryAIDefaultModelIfMissingTx(tx: Pick<DbType, 'select' | 'insert'>): Promise<number> {
  const [existing] = await tx
    .select({ id: userModelTable.id })
    .from(userModelTable)
    .where(eq(userModelTable.id, CHERRYAI_DEFAULT_UNIQUE_MODEL_ID))
    .limit(1)

  if (existing) return 0

  await insertManyWithOrderKey(tx, userModelTable, [createCherryAIDefaultModelRow()], {
    pkColumn: userModelTable.id,
    scope: eq(userModelTable.providerId, CHERRYAI_PROVIDER_ID)
  })

  return 1
}
