import { providerService } from '@main/data/services/ProviderService'
import type { ModelSnapshot } from '@shared/data/types/message'
import type { Model } from '@shared/data/types/model'
import { parseUniqueModelId } from '@shared/data/types/model'

export function createModelSnapshot(input: {
  id: string
  name: string
  provider: string
  providerName?: string
  group?: string
}): ModelSnapshot {
  return {
    id: input.id,
    name: input.name,
    provider: input.provider,
    ...(input.providerName ? { providerName: input.providerName } : {}),
    ...(input.group !== undefined ? { group: input.group } : {})
  }
}

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
