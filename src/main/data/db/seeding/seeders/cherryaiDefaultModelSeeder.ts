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

import type { DbType, ISeeder } from '../../types'
import { hashObject } from '../hashObject'

export const CHERRYAI_DEFAULT_MODEL_SEEDER_NAME = 'cherryaiDefaultModel' as const
const DEFAULT_MODEL_PREFERENCE_SCOPE = 'default' as const
export const DEFAULT_MODEL_PREFERENCE_KEYS = [
  'chat.default_model_id',
  'topic.naming.model_id',
  'feature.quick_assistant.model_id',
  'feature.translate.model_id'
] as const

type TxLike = Pick<DbType, 'select' | 'insert' | 'update'>
type CherryAIProviderRow = Omit<InsertUserProviderRow, 'orderKey'>
type CherryAIDefaultModelRow = Omit<InsertUserModelRow, 'orderKey'>
type DefaultModelPreferenceRow = {
  scope: typeof DEFAULT_MODEL_PREFERENCE_SCOPE
  key: (typeof DEFAULT_MODEL_PREFERENCE_KEYS)[number]
  value: typeof CHERRYAI_DEFAULT_UNIQUE_MODEL_ID
}

function createCherryAIProviderRow(): CherryAIProviderRow {
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

function createCherryAIDefaultModelRow(): CherryAIDefaultModelRow {
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

// Exported solely for v1->v2 migration reuse; make private when migration support is dropped.
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

function createDefaultModelPreferenceRows(): DefaultModelPreferenceRow[] {
  return DEFAULT_MODEL_PREFERENCE_KEYS.map((key) => ({
    scope: DEFAULT_MODEL_PREFERENCE_SCOPE,
    key,
    value: CHERRYAI_DEFAULT_UNIQUE_MODEL_ID
  }))
}

async function ensureDefaultModelPreferencesTx(tx: TxLike): Promise<void> {
  for (const { scope, key, value } of createDefaultModelPreferenceRows()) {
    const [existing] = await tx
      .select({ value: preferenceTable.value })
      .from(preferenceTable)
      .where(and(eq(preferenceTable.scope, scope), eq(preferenceTable.key, key)))
      .limit(1)

    if (!existing) {
      await tx.insert(preferenceTable).values({
        scope,
        key,
        value
      })
      continue
    }

    if (existing.value !== null && existing.value !== '') {
      continue
    }

    await tx
      .update(preferenceTable)
      .set({ value })
      .where(and(eq(preferenceTable.scope, scope), eq(preferenceTable.key, key)))
  }
}

async function ensureCherryAIDefaultModelSetupTx(tx: TxLike): Promise<void> {
  await ensureCherryAIDefaultProviderAndModelTx(tx)
  await ensureDefaultModelPreferencesTx(tx)
}

export class CherryAIDefaultModelSeeder implements ISeeder {
  readonly name = CHERRYAI_DEFAULT_MODEL_SEEDER_NAME
  readonly description = 'Ensure CherryAI default provider, model, and default model preferences'
  readonly version: string

  constructor() {
    this.version = hashObject({
      provider: createCherryAIProviderRow(),
      model: createCherryAIDefaultModelRow(),
      preferences: createDefaultModelPreferenceRows()
    })
  }

  async run(db: DbType): Promise<void> {
    await db.transaction((tx) => ensureCherryAIDefaultModelSetupTx(tx))
  }
}
