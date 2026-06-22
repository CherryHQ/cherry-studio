import { application } from '@application'
import { ENDPOINT_TYPE } from '@cherrystudio/provider-registry'
import { RegistryLoader } from '@cherrystudio/provider-registry/node'
import type { InsertUserModelRow } from '@data/db/schemas/userModel'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { providerRegistryService } from '@data/services/ProviderRegistryService'
import { insertManyWithOrderKey } from '@data/services/utils/orderKey'
import { loggerService } from '@logger'
import { CLAUDE_CODE_PROVIDER_ID } from '@shared/data/presets/claudeCode'
import type { Model } from '@shared/data/types/model'
import { eq, inArray } from 'drizzle-orm'

import type { DbType, ISeeder } from '../../types'

const logger = loggerService.withContext('ClaudeCodeProviderSeeder')

type TxLike = Pick<DbType, 'select' | 'insert' | 'update'>
type ClaudeCodeModelRow = Omit<InsertUserModelRow, 'orderKey'>

/** `claude-opus` → `Claude Opus`, `claude` → `Claude`. Keeps the picker grouped by tier. */
function groupFromFamily(family: string | undefined): string | null {
  if (!family) return null
  return family
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function toModelRow(model: Model): ClaudeCodeModelRow {
  return {
    id: model.id,
    providerId: CLAUDE_CODE_PROVIDER_ID,
    // listProviderRegistryModels always sets apiModelId; presetModelId mirrors it (both the bare id).
    modelId: model.apiModelId ?? model.presetModelId ?? model.id,
    presetModelId: model.presetModelId ?? null,
    name: model.name,
    description: model.description ?? null,
    group: groupFromFamily(model.family),
    capabilities: model.capabilities,
    inputModalities: model.inputModalities ?? null,
    outputModalities: model.outputModalities ?? null,
    endpointTypes: model.endpointTypes ?? [ENDPOINT_TYPE.ANTHROPIC_MESSAGES],
    customEndpointUrl: null,
    contextWindow: model.contextWindow ?? null,
    maxInputTokens: model.maxInputTokens ?? null,
    maxOutputTokens: model.maxOutputTokens ?? null,
    supportsStreaming: model.supportsStreaming,
    reasoning: model.reasoning ?? null,
    parameters: model.parameterSupport ?? null,
    pricing: model.pricing ?? null,
    isEnabled: true,
    isHidden: false,
    isDeprecated: false,
    notes: null,
    userOverrides: null
  }
}

async function ensureClaudeCodeProviderEnabledTx(tx: TxLike): Promise<void> {
  // The provider row is created (disabled, like every preset) by
  // PresetProviderSeeder from providers.json, which runs earlier in the same
  // pass. Claude Code works straight off the CLI login with no API-key step, so
  // flip it on here instead of waiting for the user to enable it manually.
  await tx
    .update(userProviderTable)
    .set({ isEnabled: true })
    .where(eq(userProviderTable.providerId, CLAUDE_CODE_PROVIDER_ID))
}

async function ensureClaudeCodeModelsTx(tx: TxLike): Promise<void> {
  // claude-code cannot list models over the API (no API key — subscription
  // login only), so materialize the registry catalog into user_model. Metadata
  // (capabilities, context window, pricing) is inherited from models.json; the
  // tier aliases (opus/sonnet/haiku) are synthesized from provider-models.json.
  const models = await providerRegistryService.listProviderRegistryModels({ providerId: CLAUDE_CODE_PROVIDER_ID })
  if (models.length === 0) return

  const rows = models.map(toModelRow)
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
  readonly description = 'Enable the agent-only Claude Code provider and materialize its registry models'

  private _loader?: RegistryLoader

  private getLoader(): RegistryLoader {
    if (!this._loader) {
      this._loader = new RegistryLoader({
        models: application.getPath('feature.provider_registry.data', 'models.json'),
        providers: application.getPath('feature.provider_registry.data', 'providers.json'),
        providerModels: application.getPath('feature.provider_registry.data', 'provider-models.json')
      })
    }
    return this._loader
  }

  // Re-seed whenever the registry's provider-model catalog changes (where the
  // claude-code model set lives). Enabling is idempotent, so over-eager re-runs
  // from unrelated catalog edits are harmless.
  get version(): string {
    return this.getLoader().getProviderModelsVersion()
  }

  async run(db: DbType): Promise<void> {
    await db.transaction(async (tx) => {
      await ensureClaudeCodeProviderEnabledTx(tx)
      await ensureClaudeCodeModelsTx(tx)
    })
  }
}
