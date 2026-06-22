import { ENDPOINT_TYPE } from '@cherrystudio/provider-registry'
import type { InsertUserModelRow } from '@data/db/schemas/userModel'
import { userModelTable } from '@data/db/schemas/userModel'
import type { InsertUserProviderRow } from '@data/db/schemas/userProvider'
import { providerService } from '@data/services/ProviderService'
import { insertManyWithOrderKey } from '@data/services/utils/orderKey'
import { loggerService } from '@logger'
import {
  CLAUDE_CODE_API_BASE_URL,
  CLAUDE_CODE_DEFAULT_MODELS,
  CLAUDE_CODE_PROVIDER_ID,
  CLAUDE_CODE_PROVIDER_NAME
} from '@shared/data/presets/claudeCode'
import type { ModelCapability } from '@shared/data/types/model'
import { createUniqueModelId } from '@shared/data/types/model'
import { eq, inArray } from 'drizzle-orm'

import type { DbType, ISeeder } from '../../types'
import { hashObject } from '../hashObject'

const logger = loggerService.withContext('ClaudeCodeProviderSeeder')

type TxLike = Pick<DbType, 'select' | 'insert' | 'update'>
type ClaudeCodeProviderRow = Omit<InsertUserProviderRow, 'orderKey'>
type ClaudeCodeModelRow = Omit<InsertUserModelRow, 'orderKey'>

function createClaudeCodeProviderRow(): ClaudeCodeProviderRow {
  return {
    providerId: CLAUDE_CODE_PROVIDER_ID,
    // Canonical preset (providerId === presetProviderId) → undeletable by users.
    presetProviderId: CLAUDE_CODE_PROVIDER_ID,
    name: CLAUDE_CODE_PROVIDER_NAME,
    endpointConfigs: {
      [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: {
        baseUrl: CLAUDE_CODE_API_BASE_URL,
        adapterFamily: 'anthropic'
      }
    },
    defaultChatEndpoint: ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
    // No API key: the Claude Agent SDK falls back to the user's Claude Code CLI
    // subscription login when no ANTHROPIC_API_KEY is injected at runtime.
    authConfig: null,
    apiFeatures: null,
    providerSettings: null,
    isEnabled: true
  }
}

function createClaudeCodeModelRow(model: (typeof CLAUDE_CODE_DEFAULT_MODELS)[number]): ClaudeCodeModelRow {
  return {
    id: createUniqueModelId(CLAUDE_CODE_PROVIDER_ID, model.id),
    providerId: CLAUDE_CODE_PROVIDER_ID,
    modelId: model.id,
    presetModelId: null,
    name: model.name,
    description: null,
    group: model.group,
    capabilities: [] as ModelCapability[],
    inputModalities: null,
    outputModalities: null,
    endpointTypes: [ENDPOINT_TYPE.ANTHROPIC_MESSAGES],
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

async function ensureClaudeCodeProviderAndModelsTx(tx: TxLike): Promise<void> {
  await providerService.batchUpsertTx(tx, [createClaudeCodeProviderRow()])

  const rows = CLAUDE_CODE_DEFAULT_MODELS.map(createClaudeCodeModelRow)
  const ids = rows.map((r) => r.id)
  const existing = await tx
    .select({ id: userModelTable.id })
    .from(userModelTable)
    .where(inArray(userModelTable.id, ids))
  const existingIds = new Set(existing.map((r) => r.id))

  const newRows = rows.filter((r) => !existingIds.has(r.id))
  if (newRows.length === 0) return

  logger.info('Seeding Claude Code default models', { count: newRows.length })
  await insertManyWithOrderKey(tx, userModelTable, newRows, {
    pkColumn: userModelTable.id,
    scope: eq(userModelTable.providerId, CLAUDE_CODE_PROVIDER_ID)
  })
}

export class ClaudeCodeProviderSeeder implements ISeeder {
  readonly name = 'claudeCodeProvider'
  readonly description = 'Ensure the agent-only Claude Code provider and its default models'
  readonly version: string

  constructor() {
    this.version = hashObject({
      provider: createClaudeCodeProviderRow(),
      models: CLAUDE_CODE_DEFAULT_MODELS.map(createClaudeCodeModelRow)
    })
  }

  async run(db: DbType): Promise<void> {
    await db.transaction((tx) => ensureClaudeCodeProviderAndModelsTx(tx))
  }
}
