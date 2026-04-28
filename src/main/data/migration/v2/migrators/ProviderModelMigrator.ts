/**
 * Migrates legacy Redux llm providers/models into v2 user tables.
 *
 * Also owns the one-shot migration of the legacy Dexie `pinned:models` key
 * into the `pin` table (entityType='model'). `pinned:models` is therefore
 * intentionally NOT classified as a preference in classification.json —
 * codegen must not emit a generic preference mapping for it, or the same
 * data would be written twice.
 */

import { pinTable } from '@data/db/schemas/pin'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { assignOrderKeysInSequence } from '@data/migration/v2/utils/orderKey'
import { loggerService } from '@logger'
import type { ExecuteResult, PrepareResult, ValidateResult } from '@shared/data/migration/v2/types'
import { createUniqueModelId, isUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import type { Provider as LegacyProvider } from '@types'
import { eq, sql } from 'drizzle-orm'

import type { MigrationContext } from '../core/MigrationContext'
import { assignOrderKeysInSequence } from '../utils/orderKey'
import { BaseMigrator } from './BaseMigrator'
import { type OldLlmSettings, transformModel, transformProvider } from './mappings/ProviderModelMappings'

const logger = loggerService.withContext('ProviderModelMigrator')

const BATCH_SIZE = 100

interface LlmState {
  providers?: LegacyProvider[]
  settings?: OldLlmSettings
}

function createModelId(providerId: string, modelId: string): UniqueModelId | null {
  try {
    return createUniqueModelId(providerId, modelId)
  } catch {
    return null
  }
}

function normalizePinnedModelObject(value: unknown): UniqueModelId | null {
  if (!value || typeof value !== 'object') return null

  const { id, provider } = value as { id?: unknown; provider?: unknown }
  if (typeof provider !== 'string' || typeof id !== 'string') return null

  return createModelId(provider.trim(), id.trim())
}

function normalizePinnedModelId(value: unknown): UniqueModelId | null {
  const objectModelId = normalizePinnedModelObject(value)
  if (objectModelId) return objectModelId

  if (typeof value !== 'string') return null

  const trimmed = value.trim()
  if (!trimmed) return null
  if (isUniqueModelId(trimmed)) return trimmed

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

  return createModelId(providerId, modelId)
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

  override reset(): void {
    this.providers = []
    this.settings = {}
    this.totalModelCount = 0
    this.pinnedModelIds = []
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

      // Deduplicate providers by ID (corrupted Redux state may contain duplicates)
      const seenIds = new Set<string>()
      const dedupedProviders: LegacyProvider[] = []
      let skippedProviders = 0
      for (const provider of llmState.providers) {
        if (seenIds.has(provider.id)) {
          skippedProviders++
          logger.warn('Duplicate provider ID skipped', { providerId: provider.id })
          continue
        }
        seenIds.add(provider.id)
        dedupedProviders.push(provider)
      }

      this.providers = dedupedProviders
      this.settings = llmState.settings ?? {}
      this.totalModelCount = this.providers.reduce((count, provider) => {
        const uniqueModelIds = new Set((provider.models ?? []).map((model) => model.id))
        return count + uniqueModelIds.size
      }, 0)
      const validModelIds = new Set(
        this.providers.flatMap((provider) =>
          Array.from(new Set((provider.models ?? []).map((model) => model.id)))
            .map((modelId) => createModelId(provider.id, modelId))
            .filter((modelId): modelId is UniqueModelId => Boolean(modelId))
        )
      )
      this.pinnedModelIds = normalizePinnedModelIds(ctx.sources.dexieSettings.get('pinned:models'), validModelIds)

      if (skippedProviders > 0) {
        warnings.push(`Skipped ${skippedProviders} duplicate provider(s)`)
      }

      logger.info('Preparation completed', {
        providerCount: this.providers.length,
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
      logger.error('Preparation failed', error as Error)
      return {
        success: false,
        itemCount: 0,
        warnings: [error instanceof Error ? error.message : String(error)]
      }
    }
  }

  async execute(ctx: MigrationContext): Promise<ExecuteResult> {
    if (this.providers.length === 0) {
      return { success: true, processedCount: 0 }
    }

    let processedProviders = 0
    let processedModels = 0

    try {
      await ctx.db.transaction(async (tx) => {
        const providerRows = assignOrderKeysInSequence(
          this.providers.map((provider) => transformProvider(provider, this.settings))
        )

        for (let providerIndex = 0; providerIndex < this.providers.length; providerIndex++) {
          const provider = this.providers[providerIndex]
          await tx.insert(userProviderTable).values(providerRows[providerIndex])
          processedProviders++

          const uniqueModels = Array.from(new Map((provider.models ?? []).map((model) => [model.id, model])).values())

          for (let modelIndex = 0; modelIndex < uniqueModels.length; modelIndex += BATCH_SIZE) {
            const batch = uniqueModels
              .slice(modelIndex, modelIndex + BATCH_SIZE)
              .map((model, batchIndex) => transformModel(model, provider.id, modelIndex + batchIndex))

            if (batch.length > 0) {
              await tx.insert(userModelTable).values(batch)
              processedModels += batch.length
            }
          }

          this.reportProgress(
            Math.round(((providerIndex + 1) / this.providers.length) * 100),
            `Migrated ${processedProviders}/${this.providers.length} providers and ${processedModels} models`
          )
        }

        const pinRows = assignOrderKeysInSequence(
          this.pinnedModelIds.map((entityId) => ({
            entityType: 'model' as const,
            entityId
          }))
        )
        if (pinRows.length > 0) {
          await tx.insert(pinTable).values(pinRows).onConflictDoNothing()
        }
      })

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
      logger.error('Execute failed', error as Error)
      return {
        success: false,
        processedCount: processedProviders,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  async validate(ctx: MigrationContext): Promise<ValidateResult> {
    try {
      const errors: { key: string; message: string }[] = []

      const providerResult = await ctx.db.select({ count: sql<number>`count(*)` }).from(userProviderTable).get()
      const modelResult = await ctx.db.select({ count: sql<number>`count(*)` }).from(userModelTable).get()
      const pinResult = await ctx.db
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

      const sampleProviders = await ctx.db.select().from(userProviderTable).limit(5).all()
      for (const provider of sampleProviders) {
        const sourceProvider = this.providers.find((item) => item.id === provider.providerId)
        if (sourceProvider?.apiKey && (!provider.apiKeys || provider.apiKeys.length === 0)) {
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
      logger.error('Validation failed', error as Error)
      return {
        success: false,
        errors: [{ key: 'validation', message: error instanceof Error ? error.message : String(error) }],
        stats: {
          sourceCount: this.providers.length,
          targetCount: 0,
          skippedCount: 0
        }
      }
    }
  }
}
