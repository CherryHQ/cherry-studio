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
import { loggerService } from '@logger'
import type { ExecuteResult, PrepareResult, ValidateResult } from '@shared/data/migration/v2/types'
import { createUniqueModelId, isUniqueModelId, parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import type { Model as LegacyModel, Provider as LegacyProvider } from '@types'
import { eq, sql } from 'drizzle-orm'

import type { MigrationContext } from '../core/MigrationContext'
import { assignOrderKeysInSequence } from '../utils/orderKey'
import { BaseMigrator } from './BaseMigrator'
import type { OldAssistant } from './mappings/AssistantMappings'
import type { OldMessage, OldTopic } from './mappings/ChatMappings'
import type { LegacyKnowledgeState } from './mappings/KnowledgeMappings'
import { type OldLlmSettings, transformModel, transformProvider } from './mappings/ProviderModelMappings'
import { legacyModelToUniqueId } from './transformers/ModelTransformers'

const logger = loggerService.withContext('ProviderModelMigrator')

const BATCH_SIZE = 100

interface LlmState {
  providers?: LegacyProvider[]
  settings?: OldLlmSettings
  defaultModel?: Partial<LegacyModel>
  topicNamingModel?: Partial<LegacyModel>
  quickModel?: Partial<LegacyModel>
  translateModel?: Partial<LegacyModel>
}

interface AssistantState {
  assistants?: OldAssistant[]
  presets?: OldAssistant[]
}

type CollectedModel = Partial<LegacyModel> & { id: string; provider: string }
interface UnknownProviderSample {
  source: string
  providerId: string
  modelId: string
}

interface MessageReferenceRegistrationResult {
  skippedBareModelId: boolean
  bareModelIdMismatch?: {
    messageId: string
    modelId: string
    messageModelId: string
  }
}

type BareModelIdMismatch = NonNullable<MessageReferenceRegistrationResult['bareModelIdMismatch']>

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
  private modelsByProvider = new Map<string, Map<string, CollectedModel>>()
  private providerIds: ReadonlySet<string> = new Set()
  private skippedUnknownProviderRefs = 0
  private skippedUnknownProviderSamples: UnknownProviderSample[] = []

  override reset(): void {
    this.providers = []
    this.settings = {}
    this.totalModelCount = 0
    this.pinnedModelIds = []
    this.modelsByProvider = new Map()
    this.providerIds = new Set()
    this.skippedUnknownProviderRefs = 0
    this.skippedUnknownProviderSamples = []
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
      this.providerIds = new Set(this.providers.map((provider) => provider.id))

      for (const provider of this.providers) {
        for (const model of provider.models ?? []) {
          this.registerModelReference({ ...model, provider: provider.id }, `provider:${provider.id}`)
        }
      }
      this.collectLlmModelReferences(llmState)
      this.collectAssistantModelReferences(ctx)
      this.collectKnowledgeModelReferences(ctx)
      await this.collectChatModelReferences(ctx)

      this.totalModelCount = Array.from(this.modelsByProvider.values()).reduce(
        (count, models) => count + models.size,
        0
      )
      const validModelIds = new Set(
        this.providers.flatMap((provider) =>
          Array.from(this.modelsByProvider.get(provider.id)?.keys() ?? [])
            .map((modelId) => createModelId(provider.id, modelId))
            .filter((modelId): modelId is UniqueModelId => Boolean(modelId))
        )
      )
      this.pinnedModelIds = normalizePinnedModelIds(ctx.sources.dexieSettings.get('pinned:models'), validModelIds)

      if (skippedProviders > 0) {
        warnings.push(`Skipped ${skippedProviders} duplicate provider(s)`)
      }

      if (this.skippedUnknownProviderRefs > 0) {
        logger.warn('Skipped model references for unknown providers during migration', {
          count: this.skippedUnknownProviderRefs,
          samples: this.skippedUnknownProviderSamples
        })
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
        for (let providerIndex = 0; providerIndex < this.providers.length; providerIndex++) {
          const provider = this.providers[providerIndex]
          await tx.insert(userProviderTable).values(transformProvider(provider, this.settings, providerIndex))
          processedProviders++

          const uniqueModels = Array.from(this.modelsByProvider.get(provider.id)?.values() ?? [])

          for (let modelIndex = 0; modelIndex < uniqueModels.length; modelIndex += BATCH_SIZE) {
            const batch = uniqueModels
              .slice(modelIndex, modelIndex + BATCH_SIZE)
              .map((model, batchIndex) => transformModel(model as LegacyModel, provider.id, modelIndex + batchIndex))

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

  private collectLlmModelReferences(llmState: LlmState): void {
    this.registerModelReference(llmState.defaultModel, 'llm.defaultModel')
    this.registerModelReference(llmState.topicNamingModel, 'llm.topicNamingModel')
    this.registerModelReference(llmState.quickModel, 'llm.quickModel')
    this.registerModelReference(llmState.translateModel, 'llm.translateModel')
  }

  private collectAssistantModelReferences(ctx: MigrationContext): void {
    const assistantState = ctx.sources.reduxState.getCategory<AssistantState>('assistants')
    const assistants: unknown[] = [
      ...(Array.isArray(assistantState?.assistants) ? assistantState.assistants : []),
      ...(Array.isArray(assistantState?.presets) ? assistantState.presets : [])
    ]

    for (const assistant of assistants) {
      if (!assistant || typeof assistant !== 'object') {
        continue
      }
      const assistantRecord = assistant as OldAssistant
      const assistantId = assistantRecord.id ?? 'unknown'
      this.registerModelReference(assistantRecord.model, `assistant:${assistantId}`)
      this.registerModelReference(assistantRecord.defaultModel, `assistant:${assistantId}.defaultModel`)
      this.registerModelReference(
        assistantRecord.settings?.defaultModel,
        `assistant:${assistantId}.settings.defaultModel`
      )
    }
  }

  private collectKnowledgeModelReferences(ctx: MigrationContext): void {
    const knowledgeState = ctx.sources.reduxState.getCategory<LegacyKnowledgeState>('knowledge')
    const bases: unknown[] = Array.isArray(knowledgeState?.bases) ? knowledgeState.bases : []

    for (const [index, base] of bases.entries()) {
      if (!base || typeof base !== 'object') {
        continue
      }

      const baseRecord = base as NonNullable<LegacyKnowledgeState['bases']>[number]
      const sourcePrefix = `knowledge[${index}]:${baseRecord.id ?? 'unknown'}`
      this.registerModelReference(baseRecord.model, `${sourcePrefix}.model`)
      this.registerModelReference(baseRecord.rerankModel, `${sourcePrefix}.rerankModel`)
    }
  }

  private async collectChatModelReferences(ctx: MigrationContext): Promise<void> {
    if (!(await ctx.sources.dexieExport.tableExists('topics'))) {
      return
    }

    let skippedBareModelIds = 0
    const skippedBareModelSamples: string[] = []
    let mismatchedBareModelIds = 0
    const mismatchedBareModelSamples: BareModelIdMismatch[] = []
    const topicReader = ctx.sources.dexieExport.createStreamReader('topics')
    await topicReader.readInBatches<OldTopic>(BATCH_SIZE, async (topics) => {
      for (const topic of topics) {
        if (!topic || !Array.isArray(topic.messages)) {
          continue
        }
        for (const message of topic.messages) {
          if (!message || typeof message !== 'object') {
            continue
          }

          const result = this.registerMessageModelReference(message)
          if (result.skippedBareModelId) {
            skippedBareModelIds += 1
            if (skippedBareModelSamples.length < 5) {
              skippedBareModelSamples.push(`${message.id}:${message.modelId}`)
            }
          }

          if (result.bareModelIdMismatch) {
            mismatchedBareModelIds += 1
            if (mismatchedBareModelSamples.length < 5) {
              mismatchedBareModelSamples.push(result.bareModelIdMismatch)
            }
          }
        }
      }
    })

    if (skippedBareModelIds > 0) {
      logger.warn('Skipped legacy bare modelId references during migration', {
        count: skippedBareModelIds,
        samples: skippedBareModelSamples
      })
    }

    if (mismatchedBareModelIds > 0) {
      logger.warn('Detected mismatched legacy bare modelId values during migration', {
        count: mismatchedBareModelIds,
        samples: mismatchedBareModelSamples
      })
    }
  }

  private registerMessageModelReference(message: OldMessage): MessageReferenceRegistrationResult {
    this.registerModelReference(message.model, `message:${message.id}`)
    let skippedBareModelId = false
    let bareModelIdMismatch: MessageReferenceRegistrationResult['bareModelIdMismatch']

    if (typeof message.modelId === 'string' && message.modelId) {
      const rawModelId = message.modelId.trim()
      const normalizedMessageModel = this.normalizeModelReference(message.model)

      if (normalizedMessageModel && this.providerIds.has(normalizedMessageModel.providerId)) {
        const messageModelId = isUniqueModelId(rawModelId)
          ? legacyModelToUniqueId(normalizedMessageModel.model)
          : normalizedMessageModel.model.id

        if (messageModelId && messageModelId !== rawModelId) {
          bareModelIdMismatch = {
            messageId: message.id,
            modelId: rawModelId,
            messageModelId
          }
        }
      } else if (isUniqueModelId(rawModelId)) {
        this.registerModelReference({ id: rawModelId }, `message:${message.id}.modelId`)
      } else {
        skippedBareModelId = true
      }
    }

    if (Array.isArray(message.mentions)) {
      for (const [index, mention] of message.mentions.entries()) {
        this.registerModelReference(mention, `message:${message.id}.mentions[${index}]`)
      }
    }

    return { skippedBareModelId, bareModelIdMismatch }
  }

  private registerModelReference(model: Partial<LegacyModel> | null | undefined, source: string): void {
    const normalized = this.normalizeModelReference(model)
    if (!normalized) {
      return
    }

    if (!this.providerIds.has(normalized.providerId)) {
      this.skippedUnknownProviderRefs += 1
      if (this.skippedUnknownProviderSamples.length < 5) {
        this.skippedUnknownProviderSamples.push({
          source,
          providerId: normalized.providerId,
          modelId: normalized.model.id
        })
      }
      return
    }

    const models = this.getModelMap(normalized.providerId)
    if (!models.has(normalized.model.id)) {
      models.set(normalized.model.id, normalized.model)
    }
  }

  private normalizeModelReference(
    model: Partial<LegacyModel> | null | undefined
  ): { providerId: string; model: CollectedModel } | null {
    if (!model || typeof model !== 'object') {
      return null
    }

    const rawModelId = model.id?.trim()
    const explicitProviderId = model.provider?.trim()
    if (!rawModelId) {
      return null
    }

    if (
      isUniqueModelId(rawModelId) &&
      explicitProviderId &&
      !explicitProviderId.includes('::') &&
      this.providerIds.has(explicitProviderId)
    ) {
      const parsedUniqueModelId = parseUniqueModelId(rawModelId)

      if (!this.providerIds.has(parsedUniqueModelId.providerId)) {
        return {
          providerId: explicitProviderId,
          model: {
            ...model,
            id: parsedUniqueModelId.modelId,
            provider: explicitProviderId,
            name: model.name?.trim() || parsedUniqueModelId.modelId,
            group: model.group?.trim() || undefined
          }
        }
      }
    }

    const uniqueId = legacyModelToUniqueId({ id: model.id, provider: model.provider }, model.id)
    if (!uniqueId) {
      return null
    }

    const { providerId, modelId } = parseUniqueModelId(uniqueId)
    return {
      providerId,
      model: {
        ...model,
        id: modelId,
        provider: providerId,
        name: model.name?.trim() || modelId,
        group: model.group?.trim() || undefined
      }
    }
  }

  private getModelMap(providerId: string): Map<string, CollectedModel> {
    let models = this.modelsByProvider.get(providerId)
    if (!models) {
      models = new Map()
      this.modelsByProvider.set(providerId, models)
    }
    return models
  }
}
