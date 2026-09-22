import { providerService } from '@main/data/services/ProviderService'
import { createModelSnapshot, type ModelSnapshot } from '@shared/data/types/message'
import type { Model } from '@shared/data/types/model'
import { parseUniqueModelId } from '@shared/data/types/model'

export function resolveSnapshotProviderName(providerId: string): string | undefined {
  try {
    const name = providerService.getByProviderId(providerId).name.trim()
    return name || undefined
  } catch {
    return undefined
  }
}

export function buildModelSnapshotFromRuntimeModel(model: Model): ModelSnapshot {
  return createModelSnapshot({
    id: model.apiModelId ?? parseUniqueModelId(model.id).modelId,
    name: model.name,
    provider: model.providerId,
    providerName: resolveSnapshotProviderName(model.providerId)
  })
}
