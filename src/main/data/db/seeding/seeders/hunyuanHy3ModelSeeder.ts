import type { InsertUserModelRow } from '@data/db/schemas/userModel'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { insertManyWithOrderKey } from '@data/services/utils/orderKey'
import { loggerService } from '@logger'
import {
  HUNYUAN_HY3_MODEL_GROUP,
  HUNYUAN_HY3_MODEL_ID,
  HUNYUAN_HY3_MODEL_NAME,
  HUNYUAN_HY3_UNIQUE_MODEL_ID,
  HUNYUAN_PROVIDER_ID
} from '@shared/data/presets/hunyuan'
import { ENDPOINT_TYPE, MODALITY, MODEL_CAPABILITY, REASONING_EFFORT } from '@shared/data/types/model'
import { eq } from 'drizzle-orm'

import type { DbType, ISeeder } from '../../types'
import { hashObject } from '../hashObject'

const logger = loggerService.withContext('HunyuanHy3ModelSeeder')

type TxLike = Pick<DbType, 'select' | 'insert'>
type HunyuanHy3ModelRow = Omit<InsertUserModelRow, 'orderKey'>

/**
 * Build the single preset Hunyuan model row. Mirrors the registry config in
 * `providers.json` / `provider-models.json`: `hy3` is reachable over both the
 * OpenAI chat-completions endpoint (normal chat) and the Anthropic messages
 * endpoint (agent chat), and exposes the industry-aligned reasoning_effort
 * knob with two levels — `none` (快思考) and `high` (慢思考).
 */
function createHunyuanHy3ModelRow(): HunyuanHy3ModelRow {
  return {
    id: HUNYUAN_HY3_UNIQUE_MODEL_ID,
    providerId: HUNYUAN_PROVIDER_ID,
    modelId: HUNYUAN_HY3_MODEL_ID,
    presetModelId: HUNYUAN_HY3_MODEL_ID,
    name: HUNYUAN_HY3_MODEL_NAME,
    description: null,
    group: HUNYUAN_HY3_MODEL_GROUP,
    capabilities: [MODEL_CAPABILITY.FUNCTION_CALL, MODEL_CAPABILITY.REASONING],
    inputModalities: [MODALITY.TEXT],
    outputModalities: [MODALITY.TEXT],
    endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS, ENDPOINT_TYPE.ANTHROPIC_MESSAGES],
    customEndpointUrl: null,
    contextWindow: null,
    maxInputTokens: null,
    maxOutputTokens: null,
    supportsStreaming: true,
    reasoning: {
      type: 'openai-chat',
      supportedEfforts: [REASONING_EFFORT.NONE, REASONING_EFFORT.HIGH]
    },
    parameters: null,
    pricing: null,
    isEnabled: true,
    isHidden: false,
    isDeprecated: false,
    notes: null,
    userOverrides: null
  }
}

async function ensureHunyuanHy3ModelTx(tx: TxLike): Promise<void> {
  // The Hunyuan provider row is seeded by PresetProviderSeeder. Attaching a
  // user_model with a missing FK would fail, so skip rather than crash when
  // the provider is absent (e.g. user-deleted on an existing install).
  const [provider] = await tx
    .select({ providerId: userProviderTable.providerId })
    .from(userProviderTable)
    .where(eq(userProviderTable.providerId, HUNYUAN_PROVIDER_ID))
    .limit(1)

  if (!provider) {
    logger.debug('Skipping Hunyuan hy3 model seed — provider row absent', { providerId: HUNYUAN_PROVIDER_ID })
    return
  }

  const [existing] = await tx
    .select({ id: userModelTable.id })
    .from(userModelTable)
    .where(eq(userModelTable.id, HUNYUAN_HY3_UNIQUE_MODEL_ID))
    .limit(1)

  if (existing) return

  await insertManyWithOrderKey(tx, userModelTable, [createHunyuanHy3ModelRow()], {
    pkColumn: userModelTable.id,
    scope: eq(userModelTable.providerId, HUNYUAN_PROVIDER_ID)
  })
}

export class HunyuanHy3ModelSeeder implements ISeeder {
  readonly name = 'hunyuanHy3Model'
  readonly description = 'Ensure the preset Hunyuan hy3 model exists'
  readonly version: string

  constructor() {
    this.version = hashObject({ model: createHunyuanHy3ModelRow() })
  }

  async run(db: DbType): Promise<void> {
    await db.transaction((tx) => ensureHunyuanHy3ModelTx(tx))
  }
}
