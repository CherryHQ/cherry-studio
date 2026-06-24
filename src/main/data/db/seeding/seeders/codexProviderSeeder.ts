import { application } from '@application'
import { ENDPOINT_TYPE } from '@cherrystudio/provider-registry'
import { RegistryLoader } from '@cherrystudio/provider-registry/node'
import type { InsertUserModelRow } from '@data/db/schemas/userModel'
import { userModelTable } from '@data/db/schemas/userModel'
import { providerRegistryService } from '@data/services/ProviderRegistryService'
import { insertManyWithOrderKey } from '@data/services/utils/orderKey'
import { loggerService } from '@logger'
import { OPENAI_CODEX_PROVIDER_ID } from '@shared/data/presets/codex'
import type { Model } from '@shared/data/types/model'
import { eq, inArray } from 'drizzle-orm'

import type { DbType, ISeeder } from '../../types'

const logger = loggerService.withContext('CodexProviderSeeder')

type TxLike = Pick<DbType, 'select' | 'insert' | 'update'>
type CodexModelRow = Omit<InsertUserModelRow, 'orderKey'>

/** `gpt-codex` → `Gpt Codex`. Keeps the picker grouped by family. */
function groupFromFamily(family: string | undefined): string | null {
  if (!family) return null
  return family
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function toModelRow(model: Model): CodexModelRow {
  return {
    id: model.id,
    providerId: OPENAI_CODEX_PROVIDER_ID,
    // The override's apiModelId carries the dotted ChatGPT-backend id (e.g.
    // gpt-5.4) that the codex responses endpoint expects on the wire.
    modelId: model.apiModelId ?? model.presetModelId ?? model.id,
    presetModelId: model.presetModelId ?? null,
    name: model.name,
    description: model.description ?? null,
    group: groupFromFamily(model.family),
    capabilities: model.capabilities,
    inputModalities: model.inputModalities ?? null,
    outputModalities: model.outputModalities ?? null,
    endpointTypes: model.endpointTypes ?? [ENDPOINT_TYPE.OPENAI_RESPONSES],
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

async function ensureCodexModelsTx(tx: TxLike): Promise<void> {
  // Codex cannot list models over a standard API (login-only), so materialize
  // the registry catalog into user_model. The provider row stays disabled until
  // the user completes OAuth sign-in (CodexOauthService flips it on).
  const models = await providerRegistryService.listProviderRegistryModels({ providerId: OPENAI_CODEX_PROVIDER_ID })
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

  logger.info('Seeding OpenAI Codex default models', { count: newRows.length })
  await insertManyWithOrderKey(tx, userModelTable, newRows, {
    pkColumn: userModelTable.id,
    scope: eq(userModelTable.providerId, OPENAI_CODEX_PROVIDER_ID)
  })
}

export class CodexProviderSeeder implements ISeeder {
  readonly name = 'codexProvider'
  readonly description = 'Materialize OpenAI Codex registry models (provider stays disabled until OAuth sign-in)'

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
  // codex model set lives). Inserts are idempotent, so over-eager re-runs are
  // harmless.
  get version(): string {
    return this.getLoader().getProviderModelsVersion()
  }

  async run(db: DbType): Promise<void> {
    await db.transaction(async (tx) => {
      await ensureCodexModelsTx(tx)
    })
  }
}
