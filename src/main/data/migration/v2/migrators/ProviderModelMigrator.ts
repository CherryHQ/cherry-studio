/**
 * Provider & Model Migrator - migrates providers and models from Redux to SQLite
 *
 * Data source: Redux `llm` slice
 * - llm.providers[]: Provider configurations with nested models[]
 * - llm.settings: Special auth settings (VertexAI, AWS Bedrock)
 *
 * Target tables:
 * - user_provider: Provider configurations
 * - user_model: Model configurations
 *
 * Preset provider models are NOT migrated (reloaded from catalog).
 * User-fetched models are fully migrated.
 */

import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { loggerService } from '@logger'
import type { ExecuteResult, PrepareResult, ValidateResult, ValidationError } from '@shared/data/migration/v2/types'
import type { Provider as LegacyProvider } from '@types'
import { sql } from 'drizzle-orm'

import type { MigrationContext } from '../core/MigrationContext'
import { BaseMigrator } from './BaseMigrator'
import { type OldLlmSettings, transformModel, transformProvider } from './mappings/ProviderModelMappings'

const logger = loggerService.withContext('ProviderModelMigrator')

const BATCH_SIZE = 100

/** LLM state structure from Redux */
interface LlmState {
  providers: LegacyProvider[]
  settings?: OldLlmSettings
}

export class ProviderModelMigrator extends BaseMigrator {
  readonly id = 'provider-model'
  readonly name = 'ProviderModel'
  readonly description = 'Migrate provider and model configuration'
  readonly order = 2

  private providers: LegacyProvider[] = []
  private settings: OldLlmSettings = {}
  private totalModelCount = 0

  async prepare(ctx: MigrationContext): Promise<PrepareResult> {
    const warnings: string[] = []

    try {
      const llmState = ctx.sources.reduxState.getCategory<LlmState>('llm')
      if (!llmState?.providers) {
        logger.warn('No llm.providers found in Redux state')
        return {
          success: true,
          itemCount: 0,
          warnings: ['No provider data found - skipping provider/model migration']
        }
      }

      this.providers = llmState.providers
      this.settings = llmState.settings ?? {}

      // Count total models across all providers
      this.totalModelCount = this.providers.reduce((sum, p) => sum + (p.models?.length ?? 0), 0)

      logger.info('Prepare completed', {
        providerCount: this.providers.length,
        totalModelCount: this.totalModelCount
      })

      return {
        success: true,
        itemCount: this.providers.length,
        warnings: warnings.length > 0 ? warnings : undefined
      }
    } catch (error) {
      logger.error('Prepare failed', error as Error)
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
      const db = ctx.db

      await db.transaction(async (tx) => {
        for (let i = 0; i < this.providers.length; i++) {
          const legacy = this.providers[i]

          // Transform and insert provider
          const newProvider = transformProvider(legacy, this.settings, i)
          await tx.insert(userProviderTable).values(newProvider)
          processedProviders++

          // Transform and insert models for this provider
          const models = legacy.models ?? []
          if (models.length > 0) {
            const seen = new Set<string>()
            const uniqueModels = models.filter((m) => {
              if (seen.has(m.id)) return false
              seen.add(m.id)
              return true
            })
            const newModels = uniqueModels.map((m, idx) => transformModel(m, legacy.id, idx))

            // Batch insert models
            for (let j = 0; j < newModels.length; j += BATCH_SIZE) {
              const batch = newModels.slice(j, j + BATCH_SIZE)
              await tx.insert(userModelTable).values(batch)
            }
            processedModels += uniqueModels.length
          }

          // Report progress
          const progress = Math.round(((i + 1) / this.providers.length) * 100)
          this.reportProgress(
            progress,
            `已迁移 ${processedProviders}/${this.providers.length} 个提供商，${processedModels} 个模型`
          )
        }
      })

      logger.info('Execute completed', { processedProviders, processedModels })

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
    const errors: ValidationError[] = []
    const db = ctx.db

    try {
      // Count providers
      const providerResult = await db.select({ count: sql<number>`count(*)` }).from(userProviderTable).get()
      const targetProviderCount = providerResult?.count ?? 0

      // Count models
      const modelResult = await db.select({ count: sql<number>`count(*)` }).from(userModelTable).get()
      const targetModelCount = modelResult?.count ?? 0

      logger.info('Validation counts', {
        sourceProviders: this.providers.length,
        targetProviders: targetProviderCount,
        sourceModels: this.totalModelCount,
        targetModels: targetModelCount
      })

      // Validate provider count
      if (targetProviderCount < this.providers.length) {
        errors.push({
          key: 'provider_count_mismatch',
          message: `Expected ${this.providers.length} providers, got ${targetProviderCount}`
        })
      }

      // Validate model count
      if (targetModelCount < this.totalModelCount) {
        errors.push({
          key: 'model_count_mismatch',
          message: `Expected ${this.totalModelCount} models, got ${targetModelCount}`
        })
      }

      // Sample validation: check a few providers have apiKeys
      const sampleProviders = await db.select().from(userProviderTable).limit(5).all()

      for (const p of sampleProviders) {
        const sourceProv = this.providers.find((sp) => sp.id === p.providerId)
        if (sourceProv?.apiKey && (!p.apiKeys || (p.apiKeys as unknown[]).length === 0)) {
          errors.push({
            key: `missing_api_key_${p.providerId}`,
            message: `Provider ${p.providerId} should have API key but has none`
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
        errors: [
          {
            key: 'validation',
            message: error instanceof Error ? error.message : String(error)
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
