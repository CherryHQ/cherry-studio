import { ENDPOINT_TYPE } from '@cherrystudio/provider-registry'
import { preferenceTable } from '@data/db/schemas/preference'
import type { InsertUserModelRow } from '@data/db/schemas/userModel'
import { userModelTable } from '@data/db/schemas/userModel'
import type { InsertUserProviderRow } from '@data/db/schemas/userProvider'
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
import type { ModelCapability } from '@shared/data/types/model'
import { and, eq } from 'drizzle-orm'

import type { DbType } from './db/types'

export const CHAT_DEFAULT_MODEL_PREFERENCE_SCOPE = 'default' as const
export const CHAT_DEFAULT_MODEL_PREFERENCE_KEY = 'chat.default_model_id' as const

type TxLike = Pick<DbType, 'select' | 'insert' | 'update'>
type CherryAIProviderRow = Omit<InsertUserProviderRow, 'orderKey'>
type CherryAIDefaultModelRow = Omit<InsertUserModelRow, 'orderKey'>

export function createCherryAIProviderRow(): CherryAIProviderRow {
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
    apiFeatures: null,
    providerSettings: null,
    isEnabled: true
  }
}

export function createCherryAIDefaultModelRow(): CherryAIDefaultModelRow {
  return {
    id: CHERRYAI_DEFAULT_UNIQUE_MODEL_ID,
    providerId: CHERRYAI_PROVIDER_ID,
    modelId: CHERRYAI_DEFAULT_MODEL_ID,
    presetModelId: null,
    name: CHERRYAI_DEFAULT_MODEL_NAME,
    description: null,
    group: CHERRYAI_DEFAULT_MODEL_GROUP,
    capabilities: [] as ModelCapability[],
    inputModalities: null,
    outputModalities: null,
    endpointTypes: null,
    customEndpointUrl: null,
    contextWindow: null,
    maxInputTokens: null,
    maxOutputTokens: null,
    supportsStreaming: true,
    reasoning: null,
    parameters: null,
    pricing: null,
    isEnabled: true,
    isHidden: false,
    isDeprecated: false,
    notes: null,
    userOverrides: null
  }
}

export async function ensureCherryAIDefaultProviderAndModelTx(tx: TxLike): Promise<void> {
  await providerService.batchUpsertTx(tx, [createCherryAIProviderRow()])

  const [existing] = await tx
    .select({ id: userModelTable.id })
    .from(userModelTable)
    .where(eq(userModelTable.id, CHERRYAI_DEFAULT_UNIQUE_MODEL_ID))
    .limit(1)

  if (existing) return

  await insertManyWithOrderKey(tx, userModelTable, [createCherryAIDefaultModelRow()], {
    pkColumn: userModelTable.id,
    scope: eq(userModelTable.providerId, CHERRYAI_PROVIDER_ID)
  })
}

export async function ensureDefaultChatModelPreferenceTx(tx: TxLike): Promise<void> {
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

  if (!existing) {
    await tx.insert(preferenceTable).values({
      scope: CHAT_DEFAULT_MODEL_PREFERENCE_SCOPE,
      key: CHAT_DEFAULT_MODEL_PREFERENCE_KEY,
      value: CHERRYAI_DEFAULT_UNIQUE_MODEL_ID
    })
    return
  }

  if (existing.value !== null && existing.value !== '') {
    return
  }

  await tx
    .update(preferenceTable)
    .set({ value: CHERRYAI_DEFAULT_UNIQUE_MODEL_ID, updatedAt: Date.now() })
    .where(
      and(
        eq(preferenceTable.scope, CHAT_DEFAULT_MODEL_PREFERENCE_SCOPE),
        eq(preferenceTable.key, CHAT_DEFAULT_MODEL_PREFERENCE_KEY)
      )
    )
}

export async function ensureCherryAIDefaultModelSetupTx(tx: TxLike): Promise<void> {
  await ensureCherryAIDefaultProviderAndModelTx(tx)
  await ensureDefaultChatModelPreferenceTx(tx)
}
