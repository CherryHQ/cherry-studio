/**
 * Migrates legacy Redux llm providers/models into v2 user tables.
 *
 * Also owns the one-shot migration of the legacy Dexie `pinned:models` key
 * into the `pin` table (entityType='model'). `pinned:models` is therefore
 * intentionally NOT classified as a preference in classification.json —
 * codegen must not emit a generic preference mapping for it, or the same
 * data would be written twice.
 */

import { application } from '@application'
import {
  ENDPOINT_TYPE,
  type EndpointType,
  type ProtoModelConfig,
  type ProtoProviderConfig
} from '@cherrystudio/provider-registry'
import { RegistryLoader } from '@cherrystudio/provider-registry/node'
import { providerLogoFileRefTable } from '@data/db/schemas/fileRelations'
import { pinTable } from '@data/db/schemas/pin'
import type { InsertUserModelRow } from '@data/db/schemas/userModel'
import { userModelTable } from '@data/db/schemas/userModel'
import type { InsertUserProviderRow, StoredEndpointConfigOverride } from '@data/db/schemas/userProvider'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { ensureCherryAiDefaultProviderAndModelTx } from '@data/db/seeding/seeders/cherryaiDefaultModelSeeder'
import { assignOrderKeysByScope, assignOrderKeysInSequence } from '@data/migration/v2/utils/orderKey'
import { matchesModelPricingBaseline, synthesizePresetFromOverride } from '@data/services/ProviderRegistryService'
import { generateOrderKeySequenceBetween } from '@data/services/utils/orderKey'
import { loggerService } from '@logger'
import type { Model as LegacyModel, Provider as LegacyProvider } from '@main/data/migration/legacyTypes'
import { isRetiredProvider } from '@main/data/retiredProviders'
import type { ExecuteResult, PrepareResult, ValidateResult } from '@shared/data/migration/v2/types'
import { CHERRYAI_DEFAULT_UNIQUE_MODEL_ID, CHERRYAI_PROVIDER_ID } from '@shared/data/presets/cherryai'
import { providerLogoRef } from '@shared/data/types/file'
import { createUniqueModelId, isUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import type { EndpointDialect } from '@shared/data/types/provider'
import { desc, eq, ne, sql } from 'drizzle-orm'
import { isEqual } from 'es-toolkit/compat'

import type { MigrationContext } from '../core/MigrationContext'
import { BaseMigrator } from './BaseMigrator'
import {
  buildProviderApiKeys,
  type OldLlmSettings,
  transformModel,
  transformProvider
} from './mappings/ProviderModelMappings'
import v1ProviderModelBaselineJson from './mappings/v1-provider-model-baseline.json'
import { legacyChatModelToUniqueId } from './transformers/ModelTransformers'
import {
  type EntityImageRef,
  insertPreparedImageEntryTx,
  insertPreparedImageRefTx,
  prepareBase64ImageFileEntry,
  type PreparedEntityImageFile,
  unlinkPreparedImages
} from './utils/logoMigration'
import { recoverV1ProviderLogoIconKey } from './utils/providerLogoCompat'

const logger = loggerService.withContext('ProviderModelMigrator')

const BATCH_SIZE = 100
/** Defaults materialized for non-system providers by final-v1 migrations 127, 129, and 132. */
const V1_CUSTOM_PROVIDER_DIALECT_BASELINE = {
  streamOptions: true,
  developerRole: false
} satisfies EndpointDialect

function inferCherryInEndpointTypes(modelId: string): EndpointType[] {
  const normalizedModelId = modelId.trim().toLowerCase()
  if (normalizedModelId.startsWith('anthropic/')) {
    return [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]
  }
  if (normalizedModelId.startsWith('google/')) {
    return [ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT]
  }
  return [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]
}

const PROVIDER_MODEL_MIGRATION_ERROR_IDS = {
  prepare: 'provider_model_prepare_failed',
  execute: 'provider_model_execute_failed',
  validate: 'provider_model_validate_failed'
} as const

type NewUserProviderInput = Omit<InsertUserProviderRow, 'orderKey'>

interface V1ModelBaseline {
  id: string
  name?: string
  description?: string
  group?: string
  capabilities?: LegacyModel['capabilities']
  endpoint_type?: LegacyModel['endpoint_type']
  supported_endpoint_types?: LegacyModel['supported_endpoint_types']
  supported_text_delta?: boolean
  pricing?: LegacyModel['pricing']
}

interface V1ProviderBaseline {
  type: LegacyProvider['type']
  apiHost?: string
  anthropicApiHost?: string
  isNotSupportDeveloperRole: boolean
  isNotSupportStreamOptions: boolean
  models: Record<string, V1ModelBaseline>
}

interface V1ProviderModelBaseline {
  sourceRevision: string
  providers: Record<string, V1ProviderBaseline>
}

const V1_PROVIDER_MODEL_BASELINE = v1ProviderModelBaselineJson as V1ProviderModelBaseline

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

function createPhaseError(message: string, cause: unknown): Error {
  const causeError = toError(cause)
  return new Error(`${message}: ${causeError.message}`, { cause: causeError })
}

function formatPhaseError(errorId: string, error: Error): string {
  return `${errorId}: ${error.message}`
}

interface LlmState {
  providers?: LegacyProvider[]
  settings?: OldLlmSettings
}

/** The provider logo slot for a given providerId (mirrors ProviderService). */
function providerLogoSlot(providerId: string) {
  return { sourceType: providerLogoRef.sourceType, sourceId: providerId, role: 'logo' }
}

function createModelId(providerId: string, modelId: string): UniqueModelId | null {
  try {
    return createUniqueModelId(providerId, modelId)
  } catch {
    return null
  }
}

function normalizePinnedProviderModelId(providerId: string, modelId: string): UniqueModelId | null {
  return legacyChatModelToUniqueId({ provider: providerId, id: modelId })
}

function normalizePinnedModelObject(value: unknown): UniqueModelId | null {
  if (!value || typeof value !== 'object') return null

  const { id, provider } = value as { id?: unknown; provider?: unknown }
  if (typeof provider !== 'string' || typeof id !== 'string') return null

  return normalizePinnedProviderModelId(provider, id)
}

function normalizePinnedModelId(value: unknown): UniqueModelId | null {
  const objectModelId = normalizePinnedModelObject(value)
  if (objectModelId) return objectModelId

  if (typeof value !== 'string') return null

  const trimmed = value.trim()
  if (!trimmed) return null
  if (isUniqueModelId(trimmed)) {
    return legacyChatModelToUniqueId(undefined, trimmed)
  }

  if (trimmed.startsWith('{')) {
    try {
      return normalizePinnedModelObject(JSON.parse(trimmed))
    } catch {
      return null
    }
  }

  const separatorIndex = trimmed.indexOf('/')
  if (separatorIndex <= 0) return null

  const providerId = trimmed.slice(0, separatorIndex).trim()
  const modelId = trimmed.slice(separatorIndex + 1).trim()
  if (!providerId || !modelId) return null

  return normalizePinnedProviderModelId(providerId, modelId)
}

function normalizePinnedModelIds(rawValue: unknown, validModelIds: ReadonlySet<string>): UniqueModelId[] {
  if (!Array.isArray(rawValue)) return []

  const normalized: UniqueModelId[] = []
  const seen = new Set<string>()

  for (const value of rawValue) {
    const modelId = normalizePinnedModelId(value)
    if (!modelId || !validModelIds.has(modelId) || seen.has(modelId)) {
      continue
    }

    seen.add(modelId)
    normalized.push(modelId)
  }

  return normalized
}

export class ProviderModelMigrator extends BaseMigrator {
  readonly id = 'provider_model'
  readonly name = 'Provider Model'
  readonly description = 'Migrate provider and model configuration from Redux to SQLite'
  readonly order = 1.75

  private providers: LegacyProvider[] = []
  private settings: OldLlmSettings = {}
  private totalModelCount = 0
  private pinnedModelIds: UniqueModelId[] = []
  private loader: RegistryLoader | null = null

  override reset(): void {
    this.providers = []
    this.settings = {}
    this.totalModelCount = 0
    this.pinnedModelIds = []
  }

  private getLoader(): RegistryLoader {
    if (!this.loader) {
      this.loader = new RegistryLoader({
        models: application.getPath('feature.provider_registry.data', 'models.json'),
        providers: application.getPath('feature.provider_registry.data', 'providers.json'),
        providerModels: application.getPath('feature.provider_registry.data', 'provider-models.json')
      })
    }
    return this.loader
  }

  private resolveEffectivePresetProvider(row: NewUserProviderInput): ProtoProviderConfig | null {
    if (row.presetProviderId === null) return null

    const providers = this.getLoader().loadProviders()
    return (
      providers.find((provider) => provider.id === row.providerId) ??
      providers.find((provider) => provider.id === row.presetProviderId) ??
      null
    )
  }

  private getV1ProviderBaseline(providerId: string): LegacyProvider | null {
    const baseline = V1_PROVIDER_MODEL_BASELINE.providers[providerId]
    if (!baseline) return null

    return {
      id: providerId,
      type: baseline.type,
      name: providerId,
      apiKey: '',
      apiHost: baseline.apiHost ?? '',
      anthropicApiHost: baseline.anthropicApiHost,
      isNotSupportDeveloperRole: baseline.isNotSupportDeveloperRole,
      isNotSupportStreamOptions: baseline.isNotSupportStreamOptions,
      models: Object.values(baseline.models).map((model) => ({
        ...model,
        provider: providerId,
        name: model.name ?? model.id,
        group: model.group ?? ''
      }))
    }
  }

  /**
   * Project a legacy provider snapshot into a sparse row delta.
   *
   * Ownership is compared with the pinned final-v1 defaults, never with the
   * current registry: comparing with today's registry cannot distinguish a
   * historical default from a user edit. Unlinked custom providers remain
   * row-owned; preset-linked custom providers use the final-v1 custom API
   * feature defaults. If the pinned baseline lacks a provider, preserve its
   * mapped values conservatively and log the gap rather than silently
   * discarding legacy data.
   */
  private projectProviderDeltaRow(row: NewUserProviderInput, legacy: LegacyProvider): NewUserProviderInput {
    const preset = this.resolveEffectivePresetProvider(row)
    if (!preset) return row

    const v1Provider = this.getV1ProviderBaseline(preset.id)
    if (!v1Provider) {
      logger.warn('Final-v1 provider baseline missing; preserving mapped provider values', {
        providerId: row.providerId,
        presetProviderId: preset.id,
        baselineRevision: V1_PROVIDER_MODEL_BASELINE.sourceRevision
      })
    }
    const v1Row = v1Provider ? transformProvider(v1Provider, {}) : null

    const endpointConfigs: Partial<Record<EndpointType, StoredEndpointConfigOverride>> = {}
    for (const [key, config] of Object.entries(row.endpointConfigs ?? {})) {
      const endpointType = key as EndpointType
      const v1Config = v1Row?.endpointConfigs?.[endpointType]
      const override: StoredEndpointConfigOverride = {}
      if (config?.baseUrl !== undefined && config.baseUrl !== v1Config?.baseUrl) {
        override.baseUrl = config.baseUrl
      }
      const dialectBaseline =
        v1Config?.dialect ?? (legacy.isSystem === true ? undefined : V1_CUSTOM_PROVIDER_DIALECT_BASELINE)
      const dialect = Object.fromEntries(
        Object.entries(config?.dialect ?? {}).filter(
          ([flag, value]) => value !== dialectBaseline?.[flag as keyof EndpointDialect]
        )
      )
      if (Object.keys(dialect).length > 0) override.dialect = dialect
      if (Object.keys(override).length > 0 || !v1Config) {
        endpointConfigs[endpointType] = override
      }
    }

    return {
      ...row,
      endpointConfigs: Object.keys(endpointConfigs).length > 0 ? endpointConfigs : null,
      defaultChatEndpoint:
        v1Row && row.defaultChatEndpoint === v1Row.defaultChatEndpoint ? null : row.defaultChatEndpoint
    }
  }

  /**
   * Project a legacy model snapshot into sparse preset deltas.
   *
   * Registry matching follows the runtime path: a provider preset enables its
   * provider-model override, while global model matching remains available to
   * fully custom providers. Provider-exclusive models are synthesized only from
   * a valid preset provider's override. User ownership is then compared with the
   * pinned final-v1 provider/model snapshot. For a model absent from that
   * snapshot, only `capabilities[].isUserSelected` is provable provenance; all
   * other fields inherit the current registry.
   */
  private projectModelDeltaRow(
    row: Omit<InsertUserModelRow, 'orderKey'>,
    providerRow: InsertUserProviderRow,
    legacy: LegacyModel
  ): Omit<InsertUserModelRow, 'orderKey'> {
    const presetProvider = this.resolveEffectivePresetProvider(providerRow)
    const endpointTypes =
      row.endpointTypes ?? (presetProvider?.id === 'cherryin' ? inferCherryInEndpointTypes(row.modelId) : null)
    const loader = this.getLoader()
    const registryOverride = presetProvider ? loader.findOverride(presetProvider.id, row.modelId) : null
    const presetModel: ProtoModelConfig | null =
      loader.findModel(registryOverride?.modelId ?? row.modelId) ??
      (registryOverride ? synthesizePresetFromOverride(registryOverride) : null)
    if (!presetModel) return endpointTypes === row.endpointTypes ? row : { ...row, endpointTypes }

    const hasExplicitCapabilitySelection =
      legacy.capabilities?.some(
        (capability) => capability.type !== 'web_search' && capability.isUserSelected !== undefined
      ) ?? false
    if (!presetProvider) {
      return {
        ...row,
        presetModelId: presetModel.id,
        capabilities: hasExplicitCapabilitySelection ? row.capabilities : null,
        inputModalities: null,
        outputModalities: null,
        contextWindow: null,
        maxInputTokens: null,
        maxOutputTokens: null,
        reasoning: null,
        parameters: null
      }
    }

    const v1Model = V1_PROVIDER_MODEL_BASELINE.providers[presetProvider.id]?.models[row.modelId]
    const v1Row = v1Model
      ? transformModel(
          {
            ...v1Model,
            provider: row.providerId,
            name: v1Model.name ?? v1Model.id,
            group: v1Model.group ?? ''
          },
          row.providerId
        )
      : null
    const endpointTypesAreV1Delta = v1Row ? !isEqual(endpointTypes, v1Row.endpointTypes) : false
    const endpointTypesNeedFallback = endpointTypes !== null && !isEqual(endpointTypes, registryOverride?.endpointTypes)

    return {
      ...row,
      presetModelId: presetModel.id,
      name: v1Row && row.name !== v1Row.name ? row.name : null,
      description: v1Row && row.description !== v1Row.description ? row.description : null,
      group: v1Row && row.group !== v1Row.group ? row.group : null,
      capabilities: hasExplicitCapabilitySelection ? row.capabilities : null,
      inputModalities: null,
      outputModalities: null,
      endpointTypes: endpointTypesAreV1Delta || endpointTypesNeedFallback ? endpointTypes : null,
      contextWindow: null,
      maxInputTokens: null,
      maxOutputTokens: null,
      supportsStreaming: v1Row && row.supportsStreaming !== v1Row.supportsStreaming ? row.supportsStreaming : null,
      reasoning: null,
      parameters: null,
      pricing: v1Row && !matchesModelPricingBaseline(row.pricing, v1Row.pricing ?? undefined) ? row.pricing : null
    }
  }

  async prepare(ctx: MigrationContext): Promise<PrepareResult> {
    try {
      const warnings: string[] = []
      const llmState = ctx.sources.reduxState.getCategory<LlmState>('llm')

      if (!llmState?.providers || !Array.isArray(llmState.providers)) {
        logger.warn('No llm.providers found in Redux state')
        return {
          success: true,
          itemCount: 0,
          warnings: ['No provider data found - skipping provider/model migration']
        }
      }

      // Filter out corrupted v1 rows before dedup. Missing/empty providerId
      // would otherwise land in userProvider as an empty-string PK (SQLite
      // text PK accepts '') and shadow lookups across the v2 data layer.
      // Symmetric treatment for model rows: invalid/duplicate model ids are
      // dropped here with explicit warns so silently-lost rows are visible.
      const seenIds = new Set<string>()
      const dedupedProviders: LegacyProvider[] = []
      let skippedProviders = 0
      let skippedManagedProviders = 0
      let skippedRetiredProviders = 0
      let skippedInvalidId = 0
      let skippedInvalidModels = 0
      let skippedDuplicateModels = 0
      const cleanProviderModels = (provider: LegacyProvider): LegacyProvider['models'] => {
        const cleaned: NonNullable<LegacyProvider['models']> = []
        const seenModelIds = new Set<string>()
        for (const model of provider.models ?? []) {
          if (typeof model?.id !== 'string' || model.id.length === 0) {
            skippedInvalidModels++
            logger.warn('Model with missing or empty id skipped', { providerId: provider.id, name: model?.name })
            continue
          }
          if (!createModelId(provider.id, model.id)) {
            skippedInvalidModels++
            logger.warn('Model with invalid id skipped', { providerId: provider.id, modelId: model.id })
            continue
          }
          if (seenModelIds.has(model.id)) {
            skippedDuplicateModels++
            logger.warn('Duplicate model id skipped', { providerId: provider.id, modelId: model.id })
            continue
          }
          seenModelIds.add(model.id)
          cleaned.push(model)
        }
        return cleaned
      }
      for (const provider of llmState.providers) {
        if (typeof provider?.id !== 'string' || provider.id.length === 0) {
          skippedInvalidId++
          logger.warn('Provider with missing or empty id skipped', { name: provider?.name })
          continue
        }
        if (provider.id === CHERRYAI_PROVIDER_ID) {
          skippedManagedProviders++
          continue
        }
        if (isRetiredProvider(provider.id, provider.presetProviderId)) {
          skippedRetiredProviders++
          continue
        }
        if (seenIds.has(provider.id)) {
          skippedProviders++
          logger.warn('Duplicate provider ID skipped', { providerId: provider.id })
          continue
        }
        seenIds.add(provider.id)
        dedupedProviders.push({ ...provider, models: cleanProviderModels(provider) })
      }

      this.providers = dedupedProviders
      this.settings = llmState.settings ?? {}
      this.totalModelCount = this.providers.reduce((count, provider) => {
        const uniqueModelIds = new Set((provider.models ?? []).map((model) => model.id))
        return count + uniqueModelIds.size
      }, 0)
      const validModelIds = new Set<UniqueModelId>([
        CHERRYAI_DEFAULT_UNIQUE_MODEL_ID,
        ...this.providers.flatMap((provider) =>
          Array.from(new Set((provider.models ?? []).map((model) => model.id)))
            .map((modelId) => createModelId(provider.id, modelId))
            .filter((modelId): modelId is UniqueModelId => Boolean(modelId))
        )
      ])
      this.pinnedModelIds = normalizePinnedModelIds(ctx.sources.dexieSettings.get('pinned:models'), validModelIds)

      if (skippedManagedProviders > 0) {
        warnings.push(`Skipped ${skippedManagedProviders} managed CherryAI provider(s)`)
      }
      if (skippedRetiredProviders > 0) {
        warnings.push(`Skipped ${skippedRetiredProviders} retired provider(s)`)
      }
      if (skippedProviders > 0) {
        warnings.push(`Skipped ${skippedProviders} duplicate provider(s)`)
      }
      if (skippedInvalidId > 0) {
        warnings.push(`Skipped ${skippedInvalidId} provider(s) with missing or empty id`)
      }
      if (skippedInvalidModels > 0) {
        warnings.push(`Skipped ${skippedInvalidModels} model(s) with invalid id`)
      }
      if (skippedDuplicateModels > 0) {
        warnings.push(`Skipped ${skippedDuplicateModels} duplicate model(s)`)
      }

      logger.info('Preparation completed', {
        providerCount: this.providers.length,
        skippedManagedProviders,
        skippedRetiredProviders,
        skippedProviders,
        modelCount: this.totalModelCount,
        pinnedModelCount: this.pinnedModelIds.length
      })

      return {
        success: true,
        itemCount: this.providers.length,
        warnings: warnings.length > 0 ? warnings : undefined
      }
    } catch (error) {
      const phaseError = createPhaseError('Provider/model preparation failed', error)
      logger.error('Preparation failed', phaseError)
      return {
        success: false,
        itemCount: 0,
        error: formatPhaseError(PROVIDER_MODEL_MIGRATION_ERROR_IDS.prepare, phaseError)
      }
    }
  }

  async execute(ctx: MigrationContext): Promise<ExecuteResult> {
    let processedProviders = 0
    let processedModels = 0

    const providerLogoFiles: PreparedEntityImageFile<EntityImageRef>[] = []
    try {
      const providerRowsWithoutOrderKey: NewUserProviderInput[] = []
      for (const provider of this.providers) {
        const row = this.projectProviderDeltaRow(transformProvider(provider, this.settings), provider)
        // v1 stored custom provider logos in Dexie settings under `image://provider-{id}`:
        // either a base64 data URL (an uploaded logo, or a small built-in logo vite inlined)
        // or a built-in-logo asset value from ProviderLogoPicker (`PROVIDER_LOGO_MAP[pickedId]`
        // — a hashed bundle path for logos over vite's 4 KB inline limit, never an `icon:` ref).
        // A data URL is promoted to an on-disk WebP file_entry referenced by the logo ref row
        // (the single source of truth, logoKey nulled). A non-`data:` value is a stale build
        // asset that no longer exists in v2 and is not a valid v2 icon ref; writing it onto
        // logoKey verbatim renders a broken image (`ProviderAvatar` treats it as an image URL),
        // and for a custom provider — whose id doesn't resolve in the icon catalog — that is the
        // only logo it has. So recover the picked brand from the asset name and re-express it as
        // a v2 `icon:<catalogKey>` ref; an unrecognized value drops to null (bundled icon by id
        // for built-in providers, initials for custom ones).
        const logo = ctx.sources.dexieSettings.get<string>(`image://provider-${provider.id}`)
        const logoFile = logo
          ? await prepareBase64ImageFileEntry(
              ctx.paths.filesDataDir,
              providerLogoSlot(provider.id),
              logo,
              // Ref-backed slot (`provider_logo`), same as the live `bindLogoImage`
              // path: reclaim when the provider is deleted or its logo replaced.
              'delete_when_unreferenced'
            )
          : null
        if (logoFile) {
          providerLogoFiles.push(logoFile)
          providerRowsWithoutOrderKey.push({ ...row, logoKey: null })
        } else {
          providerRowsWithoutOrderKey.push({ ...row, logoKey: logo ? recoverV1ProviderLogoIconKey(logo) : null })
        }
      }

      ctx.db.transaction((tx) => {
        ensureCherryAiDefaultProviderAndModelTx(tx)

        // Insert file_entries before the ref rows (their `file_entry_id` FK
        // needs them); the ref rows themselves go in after the owner rows exist
        // (their `source_id` FK needs the provider), below.
        for (const logoFile of providerLogoFiles) {
          insertPreparedImageEntryTx(tx, logoFile)
        }

        const [lastProvider] = tx
          .select({ orderKey: userProviderTable.orderKey })
          .from(userProviderTable)
          .orderBy(desc(userProviderTable.orderKey))
          .limit(1)
          .all()
        const providerOrderKeys = generateOrderKeySequenceBetween(
          lastProvider?.orderKey ?? null,
          null,
          providerRowsWithoutOrderKey.length
        )
        const providerRows = providerRowsWithoutOrderKey.map((row, index) => ({
          ...row,
          orderKey: providerOrderKeys[index]
        }))

        for (let providerIndex = 0; providerIndex < this.providers.length; providerIndex++) {
          const provider = this.providers[providerIndex]
          const providerRow = providerRows[providerIndex]
          tx.insert(userProviderTable).values(providerRow).run()
          processedProviders++

          // Model dedup + invalid-id filtering happens in prepare(); use the
          // cleaned list directly here.
          const modelRows = assignOrderKeysByScope(
            (provider.models ?? []).map((model) =>
              this.projectModelDeltaRow(transformModel(model, provider.id), providerRow, model)
            ),
            (model) => model.providerId
          )

          for (let modelIndex = 0; modelIndex < modelRows.length; modelIndex += BATCH_SIZE) {
            const batch = modelRows.slice(modelIndex, modelIndex + BATCH_SIZE)

            if (batch.length > 0) {
              tx.insert(userModelTable).values(batch).run()
              processedModels += batch.length
            }
          }

          this.reportProgress(
            Math.round(((providerIndex + 1) / this.providers.length) * 100),
            `Migrated ${processedProviders}/${this.providers.length} providers and ${processedModels} models`
          )
        }

        // Owner rows now exist — insert the logo ref rows (their `source_id` FK
        // references `user_provider.provider_id`).
        for (const logoFile of providerLogoFiles) {
          insertPreparedImageRefTx(tx, logoFile)
        }

        const pinRows = assignOrderKeysInSequence(
          this.pinnedModelIds.map((entityId) => ({
            entityType: 'model' as const,
            entityId
          }))
        )
        if (pinRows.length > 0) {
          tx.insert(pinTable).values(pinRows).onConflictDoNothing().run()
        }
      })

      // Self-check the logo ref table's FKs (fileEntryId → file_entry, sourceId →
      // user_provider) now that both sides are inserted — FK enforcement is off during
      // migration, so this catches referential errors early (v2-migration-guide.md).
      this.assertOwnedForeignKeys(ctx.db, [providerLogoFileRefTable])

      logger.info('Execute completed', {
        processedProviders,
        processedModels,
        processedPins: this.pinnedModelIds.length
      })

      return {
        success: true,
        processedCount: processedProviders
      }
    } catch (error) {
      // Unlink any logo WebP written before the tx failed — no orphans on retry.
      await unlinkPreparedImages(providerLogoFiles)
      const phaseError = createPhaseError(
        `Provider/model execution failed after ${processedProviders} provider(s)`,
        error
      )
      logger.error('Execute failed', phaseError)
      return {
        success: false,
        processedCount: processedProviders,
        error: formatPhaseError(PROVIDER_MODEL_MIGRATION_ERROR_IDS.execute, phaseError)
      }
    }
  }

  async validate(ctx: MigrationContext): Promise<ValidateResult> {
    try {
      const errors: { key: string; message: string }[] = []

      const providerResult = ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(userProviderTable)
        .where(ne(userProviderTable.providerId, CHERRYAI_PROVIDER_ID))
        .get()
      const modelResult = ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(userModelTable)
        .where(ne(userModelTable.providerId, CHERRYAI_PROVIDER_ID))
        .get()
      const pinResult = ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(pinTable)
        .where(eq(pinTable.entityType, 'model'))
        .get()
      const targetProviderCount = providerResult?.count ?? 0
      const targetModelCount = modelResult?.count ?? 0
      const targetPinCount = pinResult?.count ?? 0

      if (targetProviderCount !== this.providers.length) {
        errors.push({
          key: 'provider_count_mismatch',
          message: `Expected ${this.providers.length} providers but found ${targetProviderCount}`
        })
      }

      if (targetModelCount !== this.totalModelCount) {
        errors.push({
          key: 'model_count_mismatch',
          message: `Expected ${this.totalModelCount} models but found ${targetModelCount}`
        })
      }

      if (targetPinCount !== this.pinnedModelIds.length) {
        errors.push({
          key: 'pin_count_mismatch',
          message: `Expected ${this.pinnedModelIds.length} model pins but found ${targetPinCount}`
        })
      }

      const sampleProviders = ctx.db.select().from(userProviderTable).limit(5).all()
      for (const provider of sampleProviders) {
        const sourceProvider = this.providers.find((item) => item.id === provider.providerId)
        if (sourceProvider?.apiKey && (!provider.apiKeys || provider.apiKeys.length === 0)) {
          if (buildProviderApiKeys(sourceProvider, this.settings).length === 0) {
            logger.warn('Legacy provider API key contained no migratable entries; continuing without API keys', {
              providerId: provider.providerId
            })
            continue
          }
          errors.push({
            key: `missing_api_key_${provider.providerId}`,
            message: `Provider ${provider.providerId} should include migrated API keys`
          })
        }
      }

      return {
        success: errors.length === 0,
        errors,
        stats: {
          sourceCount: this.providers.length,
          targetCount: targetProviderCount,
          skippedCount: 0
        }
      }
    } catch (error) {
      const phaseError = createPhaseError('Provider/model validation failed', error)
      logger.error('Validation failed', phaseError)
      return {
        success: false,
        errors: [
          {
            key: PROVIDER_MODEL_MIGRATION_ERROR_IDS.validate,
            message: formatPhaseError(PROVIDER_MODEL_MIGRATION_ERROR_IDS.validate, phaseError)
          }
        ],
        stats: {
          sourceCount: this.providers.length,
          targetCount: 0,
          skippedCount: 0
        }
      }
    }
  }
}
