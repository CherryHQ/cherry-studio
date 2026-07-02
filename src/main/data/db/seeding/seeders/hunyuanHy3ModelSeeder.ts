import { application } from '@application'
import type { EndpointType, ProtoModelConfig } from '@cherrystudio/provider-registry'
import { buildRuntimeEndpointConfigs } from '@cherrystudio/provider-registry'
import { RegistryLoader } from '@cherrystudio/provider-registry/node'
import type { InsertUserModelRow } from '@data/db/schemas/userModel'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import {
  extractReasoningFormatTypes,
  mergePresetModel,
  synthesizePresetFromOverride
} from '@data/services/ProviderRegistryService'
import { insertManyWithOrderKey } from '@data/services/utils/orderKey'
import { loggerService } from '@logger'
import {
  HUNYUAN_HY3_MODEL_GROUP,
  HUNYUAN_HY3_MODEL_ID,
  HUNYUAN_HY3_UNIQUE_MODEL_ID,
  HUNYUAN_PROVIDER_ID
} from '@shared/data/presets/hunyuan'
import type { EndpointConfig } from '@shared/data/types/provider'
import { eq } from 'drizzle-orm'

import type { DbType, ISeeder } from '../../types'
import { hashObject } from '../hashObject'

const logger = loggerService.withContext('HunyuanHy3ModelSeeder')

type TxLike = Pick<DbType, 'select' | 'insert'>
type HunyuanHy3ModelRow = Omit<InsertUserModelRow, 'orderKey'>

/**
 * Build the single preset Hunyuan model row by resolving `hy3` from the registry
 * (`providers.json` / `provider-models.json`) through the same `mergePresetModel`
 * path that `ModelService.create` and the v2 migrator use. This keeps the
 * drift-prone fields (capabilities, endpoints, reasoning, modalities, name) as a
 * single source of truth in the registry instead of re-typing them here.
 *
 * `hy3` is reachable over both the OpenAI chat-completions endpoint (normal chat)
 * and the Anthropic messages endpoint (agent chat), and exposes the
 * industry-aligned reasoning_effort knob with two levels — `none` (快思考) and
 * `high` (慢思考). Seeder-local fields (group, flags) are set explicitly.
 */
function buildHunyuanHy3ModelRow(loader: RegistryLoader): HunyuanHy3ModelRow | null {
  const override = loader.findOverride(HUNYUAN_PROVIDER_ID, HUNYUAN_HY3_MODEL_ID)
  if (!override) {
    return null
  }

  const presetModel: ProtoModelConfig =
    loader.findModel(override.modelId ?? HUNYUAN_HY3_MODEL_ID) ?? synthesizePresetFromOverride(override)

  const provider = loader.loadProviders().find((p) => p.id === HUNYUAN_PROVIDER_ID)
  const endpointConfigs = provider
    ? (buildRuntimeEndpointConfigs(provider.endpointConfigs) as Partial<Record<EndpointType, EndpointConfig>> | null)
    : null
  const reasoningFormatTypes = extractReasoningFormatTypes(endpointConfigs)
  const defaultChatEndpoint = provider?.defaultChatEndpoint ?? undefined

  const merged = mergePresetModel(presetModel, override, HUNYUAN_PROVIDER_ID, reasoningFormatTypes, defaultChatEndpoint)

  return {
    id: HUNYUAN_HY3_UNIQUE_MODEL_ID,
    providerId: HUNYUAN_PROVIDER_ID,
    modelId: HUNYUAN_HY3_MODEL_ID,
    presetModelId: HUNYUAN_HY3_MODEL_ID,
    name: merged.name,
    description: merged.description ?? null,
    group: HUNYUAN_HY3_MODEL_GROUP,
    capabilities: merged.capabilities,
    inputModalities: merged.inputModalities ?? null,
    outputModalities: merged.outputModalities ?? null,
    endpointTypes: merged.endpointTypes ?? null,
    customEndpointUrl: null,
    contextWindow: merged.contextWindow ?? null,
    maxInputTokens: merged.maxInputTokens ?? null,
    maxOutputTokens: merged.maxOutputTokens ?? null,
    supportsStreaming: merged.supportsStreaming,
    reasoning: merged.reasoning ?? null,
    parameters: null,
    pricing: merged.pricing ?? null,
    isEnabled: true,
    isHidden: false,
    isDeprecated: false,
    notes: null,
    userOverrides: null
  }
}

async function ensureHunyuanHy3ModelTx(tx: TxLike, row: HunyuanHy3ModelRow): Promise<void> {
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

  await insertManyWithOrderKey(tx, userModelTable, [row], {
    pkColumn: userModelTable.id,
    scope: eq(userModelTable.providerId, HUNYUAN_PROVIDER_ID)
  })
}

export class HunyuanHy3ModelSeeder implements ISeeder {
  readonly name = 'hunyuanHy3Model'
  readonly description = 'Ensure the preset Hunyuan hy3 model exists'

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

  get version(): string {
    return hashObject({ model: buildHunyuanHy3ModelRow(this.getLoader()) })
  }

  async run(db: DbType): Promise<void> {
    const row = buildHunyuanHy3ModelRow(this.getLoader())
    if (!row) {
      logger.warn('Skipping Hunyuan hy3 model seed — registry override absent', { providerId: HUNYUAN_PROVIDER_ID })
      return
    }

    await db.transaction((tx) => ensureHunyuanHy3ModelTx(tx, row))
  }
}
