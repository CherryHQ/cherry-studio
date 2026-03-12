import { DEFAULT_KNOWLEDGE_DOCUMENT_COUNT } from '@renderer/config/constant'
import { getModel } from '@renderer/hooks/useModel'
import type { KnowledgeBase as KnowledgeBaseV1, Model, PreprocessProvider } from '@renderer/types'
import type { KnowledgeBase as KnowledgeBaseV2 } from '@shared/data/types/knowledge'
import type { ModelMeta } from '@shared/data/types/meta'

const buildMetaFromId = (modelId?: string): ModelMeta | undefined => {
  if (!modelId) {
    return undefined
  }

  const [provider, ...rest] = modelId.split(':')
  if (rest.length === 0) {
    return {
      id: modelId,
      provider: 'unknown',
      name: modelId,
      group: modelId
    }
  }

  const id = rest.join(':')
  return {
    id,
    provider,
    name: id,
    group: id
  }
}

const resolveModel = (meta?: ModelMeta, fallbackId?: string): Model | undefined => {
  const normalizedMeta = meta ?? buildMetaFromId(fallbackId)
  if (!normalizedMeta) {
    return undefined
  }

  const model = getModel(normalizedMeta.id, normalizedMeta.provider)
  if (model) {
    return model
  }

  return {
    id: normalizedMeta.id,
    provider: normalizedMeta.provider,
    name: normalizedMeta.name,
    group: normalizedMeta.group ?? normalizedMeta.id
  }
}

export const mapKnowledgeBaseV2ToV1 = (
  base: KnowledgeBaseV2,
  preprocessProviders: PreprocessProvider[] = []
): KnowledgeBaseV1 => {
  const model = resolveModel(base.embeddingModelMeta ?? undefined, base.embeddingModelId)
  const rerankModel = resolveModel(base.rerankModelMeta ?? undefined, base.rerankModelId)
  const preprocessProvider = base.fileProcessorId
    ? preprocessProviders.find((provider) => provider.id === base.fileProcessorId)
    : undefined

  const createdAt = Date.parse(base.createdAt)
  const updatedAt = Date.parse(base.updatedAt)

  return {
    id: base.id,
    name: base.name,
    description: base.description,
    model:
      model ??
      ({
        id: base.embeddingModelId,
        provider: 'unknown',
        name: base.embeddingModelId,
        group: base.embeddingModelId
      } as Model),
    dimensions: base.embeddingModelMeta?.dimensions,
    items: [],
    created_at: Number.isNaN(createdAt) ? Date.now() : createdAt,
    updated_at: Number.isNaN(updatedAt) ? Date.now() : updatedAt,
    version: 2,
    documentCount: base.documentCount ?? DEFAULT_KNOWLEDGE_DOCUMENT_COUNT,
    chunkSize: base.chunkSize,
    chunkOverlap: base.chunkOverlap,
    threshold: base.threshold,
    rerankModel,
    preprocessProvider: preprocessProvider
      ? {
          type: 'preprocess',
          provider: preprocessProvider
        }
      : undefined
  }
}
