import { serializeHealthCheckError } from '@renderer/utils/error'
import { classifyError } from '@renderer/utils/errorClassifier'
import type { BulkUpdateModelsDto, CreateModelsDto } from '@shared/data/api/schemas/models'
import { MODELS_BATCH_MAX_ITEMS, MODELS_BULK_UPDATE_MAX_ITEMS } from '@shared/data/api/schemas/models'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

import { chunkArray } from './chunkArray'
import { healthCheckErrorToDisplayString } from './healthCheck'
import { resolveCreateModelEndpointTypes, toCreateModelDto } from './modelSync'

interface PersistProviderModelsOptions {
  provider: Provider
  selectedModels: readonly Model[]
  localModels: readonly Model[]
  knownModels?: Iterable<Model>
  createModels: (models: CreateModelsDto) => Promise<Model[]>
  updateModels: (models: BulkUpdateModelsDto) => Promise<Model[]>
  onPersisted?: (models: Model[]) => void
}

export async function persistProviderModels({
  provider,
  selectedModels,
  localModels,
  knownModels = [],
  createModels,
  updateModels,
  onPersisted
}: PersistProviderModelsOptions): Promise<Model[]> {
  const uniqueSelectedModels = [...new Map(selectedModels.map((model) => [model.id, model])).values()]
  const persistedModels = new Map([...localModels, ...knownModels].map((model) => [model.id, model]))
  const modelsToRestore = uniqueSelectedModels
    .map((model) => persistedModels.get(model.id))
    .filter((model): model is Model => model != null && (!model.isEnabled || model.isHidden))

  for (const modelChunk of chunkArray(modelsToRestore, MODELS_BULK_UPDATE_MAX_ITEMS)) {
    const updatedModels = await updateModels(
      modelChunk.map((model) => ({
        uniqueModelId: model.id,
        patch: { isEnabled: true, isHidden: false }
      }))
    )
    const updatedModelsById = new Map(updatedModels.map((model) => [model.id, model]))
    const missingResult = modelChunk.find((model) => !updatedModelsById.has(model.id))
    if (missingResult) {
      throw new Error(`Updated model was not returned: ${missingResult.id}`)
    }
    for (const model of updatedModels) persistedModels.set(model.id, model)
    onPersisted?.(updatedModels)
  }

  const missingModels = uniqueSelectedModels.filter((model) => !persistedModels.has(model.id))
  for (const modelChunk of chunkArray(missingModels, MODELS_BATCH_MAX_ITEMS)) {
    const createdModels = await createModels(
      modelChunk.map((model) => toCreateModelDto(provider.id, model, resolveCreateModelEndpointTypes(provider, model)))
    )
    const createdModelsById = new Map(createdModels.map((model) => [model.id, model]))
    const missingResult = modelChunk.find((model) => !createdModelsById.has(model.id))
    if (missingResult) {
      throw new Error(`Created model was not returned: ${missingResult.id}`)
    }
    for (const model of createdModels) persistedModels.set(model.id, model)
    onPersisted?.(createdModels)
  }

  return uniqueSelectedModels.map((model) => persistedModels.get(model.id) as Model)
}

export function getProviderSetupErrorDetails(error: unknown, secrets: Iterable<string>) {
  const serializedError = serializeHealthCheckError(error)
  const classification = classifyError(serializedError)
  let summary = healthCheckErrorToDisplayString(serializedError)
  for (const secret of secrets) {
    const normalizedSecret = secret.trim()
    if (normalizedSecret) summary = summary.replaceAll(normalizedSecret, '••••')
  }
  return {
    i18nKey: classification.category === 'unknown' ? null : classification.i18nKey,
    summary
  }
}
