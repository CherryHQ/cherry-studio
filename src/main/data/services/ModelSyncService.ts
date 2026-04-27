import { application } from '@application'
import { assistantTable } from '@data/db/schemas/assistant'
import { knowledgeBaseTable } from '@data/db/schemas/knowledge'
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api'
import type { CreateModelDto } from '@shared/data/api/schemas/models'
import type {
  ModelSyncApplyDto,
  ModelSyncApplyResponse,
  ModelSyncReferenceImpact
} from '@shared/data/api/schemas/providers'
import type { CodeCliOverrides, FileProcessorOverrides } from '@shared/data/preference/preferenceTypes'
import type { Model, UniqueModelId } from '@shared/data/types/model'
import { parseUniqueModelId } from '@shared/data/types/model'
import { and, inArray, isNull, or } from 'drizzle-orm'

import { modelService } from './ModelService'
import { fetchRemoteProviderModels } from './providerModelSync/fetchRemoteProviderModels'
import { providerRegistryService } from './ProviderRegistryService'
import { providerService } from './ProviderService'

const logger = loggerService.withContext('DataApi:ModelSyncService')

const DIRECT_MODEL_PREFERENCE_KEYS = [
  'chat.default_model_id',
  'chat.web_search.compression.rag_embedding_model_id',
  'chat.web_search.compression.rag_rerank_model_id',
  'feature.quick_assistant.model_id',
  'feature.translate.model_id',
  'topic.naming.model_id'
] as const

const STRUCTURED_MODEL_PREFERENCE_KEYS = ['feature.code_cli.overrides', 'feature.file_processing.overrides'] as const

const MODEL_SYNC_PREFERENCE_KEYS = [...DIRECT_MODEL_PREFERENCE_KEYS, ...STRUCTURED_MODEL_PREFERENCE_KEYS] as const

type ModelSyncPreferenceKey = (typeof MODEL_SYNC_PREFERENCE_KEYS)[number]

const REGISTRY_FIELDS = [
  'name',
  'description',
  'group',
  'capabilities',
  'inputModalities',
  'outputModalities',
  'endpointTypes',
  'contextWindow',
  'maxOutputTokens',
  'maxInputTokens',
  'reasoning',
  'pricing',
  'family',
  'ownedBy',
  'replaceWith'
] as const satisfies ReadonlyArray<keyof Model>

function getModelKey(model: Model): string {
  return model.apiModelId ?? parseUniqueModelId(model.id).modelId
}

function toCreateModelDto(providerId: string, model: Model): CreateModelDto {
  return {
    providerId,
    modelId: getModelKey(model),
    name: model.name,
    description: model.description,
    group: model.group,
    capabilities: model.capabilities,
    inputModalities: model.inputModalities,
    outputModalities: model.outputModalities,
    endpointTypes: model.endpointTypes,
    contextWindow: model.contextWindow,
    maxOutputTokens: model.maxOutputTokens,
    supportsStreaming: model.supportsStreaming,
    reasoning: model.reasoning,
    pricing: model.pricing
  }
}

function enrichRemoteModels(remoteModels: Model[], resolvedModels: Model[]): Model[] {
  const resolvedMap = new Map<string, Model>()
  for (const model of resolvedModels) {
    resolvedMap.set(getModelKey(model), model)
  }

  return remoteModels.map((remoteModel) => {
    const resolved = resolvedMap.get(getModelKey(remoteModel))
    if (!resolved) {
      return remoteModel
    }

    const merged = { ...remoteModel }
    for (const field of REGISTRY_FIELDS) {
      const value = resolved[field]
      if (value !== undefined && value !== null && !(Array.isArray(value) && value.length === 0)) {
        ;(merged as Record<string, unknown>)[field] = value
      }
    }
    return merged
  })
}

function buildEmptyReferenceImpact(uniqueModelId: UniqueModelId): ModelSyncReferenceImpact {
  return {
    uniqueModelId,
    assistantCount: 0,
    knowledgeCount: 0,
    preferenceReferences: [],
    strongReferenceCount: 0
  }
}

class ModelSyncService {
  private async fetchResolvedRemoteModels(providerId: string): Promise<Model[]> {
    const provider = await providerService.getByProviderId(providerId)
    const apiKey = await providerService.getRotatedApiKey(providerId)
    const remoteModels = await fetchRemoteProviderModels(provider, apiKey)
    if (remoteModels.length === 0) {
      return []
    }

    const resolvedModels = await providerRegistryService.resolveModels(
      providerId,
      remoteModels.map((model) => getModelKey(model))
    )

    return enrichRemoteModels(remoteModels, resolvedModels)
  }

  private async collectReferenceImpacts(
    uniqueModelIds: UniqueModelId[]
  ): Promise<Map<UniqueModelId, ModelSyncReferenceImpact>> {
    const impacts = new Map<UniqueModelId, ModelSyncReferenceImpact>(
      uniqueModelIds.map((uniqueModelId) => [uniqueModelId, buildEmptyReferenceImpact(uniqueModelId)])
    )

    if (uniqueModelIds.length === 0) {
      return impacts
    }

    const db = application.get('DbService').getDb()

    const assistantRows = await db
      .select({ modelId: assistantTable.modelId })
      .from(assistantTable)
      .where(and(isNull(assistantTable.deletedAt), inArray(assistantTable.modelId, uniqueModelIds)))

    for (const row of assistantRows) {
      if (!row.modelId) {
        continue
      }

      const impact = impacts.get(row.modelId as UniqueModelId)
      if (impact) {
        impact.assistantCount += 1
        impact.strongReferenceCount += 1
      }
    }

    const knowledgeRows = await db
      .select({
        embeddingModelId: knowledgeBaseTable.embeddingModelId,
        rerankModelId: knowledgeBaseTable.rerankModelId
      })
      .from(knowledgeBaseTable)
      .where(
        or(
          inArray(knowledgeBaseTable.embeddingModelId, uniqueModelIds),
          inArray(knowledgeBaseTable.rerankModelId, uniqueModelIds)
        )
      )

    for (const row of knowledgeRows) {
      for (const modelId of [row.embeddingModelId, row.rerankModelId]) {
        if (!modelId) {
          continue
        }

        const impact = impacts.get(modelId as UniqueModelId)
        if (impact) {
          impact.knowledgeCount += 1
          impact.strongReferenceCount += 1
        }
      }
    }

    const preferenceService = application.get('PreferenceService') as unknown as {
      getMultipleRaw?: (keys: ModelSyncPreferenceKey[]) => Record<ModelSyncPreferenceKey, unknown>
      getMultiple: (keys: ModelSyncPreferenceKey[]) => Record<ModelSyncPreferenceKey, unknown>
    }
    const preferences =
      preferenceService.getMultipleRaw?.([...MODEL_SYNC_PREFERENCE_KEYS] as ModelSyncPreferenceKey[]) ??
      preferenceService.getMultiple([...MODEL_SYNC_PREFERENCE_KEYS] as ModelSyncPreferenceKey[])

    for (const uniqueModelId of uniqueModelIds) {
      const impact = impacts.get(uniqueModelId)
      if (!impact) {
        continue
      }

      for (const key of DIRECT_MODEL_PREFERENCE_KEYS) {
        if (preferences[key] === uniqueModelId) {
          impact.preferenceReferences.push(key)
          impact.strongReferenceCount += 1
        }
      }

      const codeCliOverrides = (preferences['feature.code_cli.overrides'] ?? {}) as CodeCliOverrides
      for (const [toolId, override] of Object.entries(codeCliOverrides)) {
        if (override?.modelId === uniqueModelId) {
          impact.preferenceReferences.push(`feature.code_cli.overrides.${toolId}.modelId`)
          impact.strongReferenceCount += 1
        }
      }

      const fileProcessingOverrides = (preferences['feature.file_processing.overrides'] ?? {}) as FileProcessorOverrides
      for (const [processorId, override] of Object.entries(fileProcessingOverrides)) {
        for (const [featureId, capabilityOverride] of Object.entries(override?.capabilities ?? {})) {
          if (capabilityOverride?.modelId === uniqueModelId) {
            impact.preferenceReferences.push(
              `feature.file_processing.overrides.${processorId}.capabilities.${featureId}.modelId`
            )
            impact.strongReferenceCount += 1
          }
        }
      }
    }

    return impacts
  }

  async apply(providerId: string, dto: ModelSyncApplyDto): Promise<ModelSyncApplyResponse> {
    const [localModels, remoteModels] = await Promise.all([
      modelService.list({ providerId }),
      this.fetchResolvedRemoteModels(providerId)
    ])

    const localModelMap = new Map(localModels.map((model) => [model.id, model]))
    const remoteModelMap = new Map(remoteModels.map((model) => [model.id, model]))
    const remoteIds = new Set(remoteModels.map((model) => model.id))

    const addTargets: Model[] = []
    for (const uniqueModelId of dto.addModelIds) {
      const model = remoteModelMap.get(uniqueModelId)
      if (model && !localModelMap.has(model.id)) {
        addTargets.push(model)
      }
    }

    const missingActions = dto.missing.filter((item) => {
      const localModel = localModelMap.get(item.uniqueModelId)
      return Boolean(localModel) && !remoteIds.has(item.uniqueModelId)
    })

    const deleteTargetIds = missingActions.filter((item) => item.action === 'delete').map((item) => item.uniqueModelId)
    const deleteImpacts = await this.collectReferenceImpacts(deleteTargetIds)
    const blockedDelete = deleteTargetIds.find(
      (uniqueModelId) => (deleteImpacts.get(uniqueModelId)?.strongReferenceCount ?? 0) > 0
    )
    if (blockedDelete) {
      throw DataApiErrorFactory.invalidOperation(`Cannot delete referenced model '${blockedDelete}'`)
    }

    let addedCount = 0
    if (addTargets.length > 0) {
      const createItems = await Promise.all(
        addTargets.map(async (model) => ({
          dto: toCreateModelDto(providerId, model),
          registryData: await providerRegistryService.lookupModel(providerId, getModelKey(model))
        }))
      )
      await modelService.create(createItems)
      addedCount = addTargets.length
    }

    let deprecatedCount = 0
    let deletedCount = 0

    for (const action of missingActions) {
      const localModel = localModelMap.get(action.uniqueModelId)
      if (!localModel) {
        continue
      }

      const { modelId } = parseUniqueModelId(localModel.id)
      if (action.action === 'delete') {
        await modelService.delete(providerId, modelId)
        deletedCount += 1
        continue
      }

      await modelService.update(providerId, modelId, { isDeprecated: true })
      deprecatedCount += 1
    }

    logger.info('Applied provider model sync changes', {
      providerId,
      addedCount,
      deprecatedCount,
      deletedCount
    })

    return {
      addedCount,
      deprecatedCount,
      deletedCount
    }
  }
}

export const modelSyncService = new ModelSyncService()
