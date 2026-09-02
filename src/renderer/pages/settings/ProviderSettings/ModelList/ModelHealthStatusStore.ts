import type { ModelWithStatus } from '@renderer/pages/settings/ProviderSettings/types/healthCheck'
import type { UniqueModelId } from '@shared/data/types/model'

export class ModelHealthStatusStore {
  private readonly listenersByModelId = new Map<UniqueModelId, Set<() => void>>()
  private statusByModelId = new Map<UniqueModelId, ModelWithStatus>()
  private orderedModelIds: UniqueModelId[] = []

  getStatus(modelId: UniqueModelId) {
    return this.statusByModelId.get(modelId)
  }

  getStatuses() {
    return this.orderedModelIds.flatMap((modelId) => {
      const status = this.statusByModelId.get(modelId)
      return status ? [status] : []
    })
  }

  subscribe(modelId: UniqueModelId, listener: () => void) {
    const listeners = this.listenersByModelId.get(modelId) ?? new Set()
    listeners.add(listener)
    this.listenersByModelId.set(modelId, listeners)

    return () => {
      listeners.delete(listener)
      if (listeners.size === 0) this.listenersByModelId.delete(modelId)
    }
  }

  setStatus(status: ModelWithStatus) {
    const modelId = status.model.id
    if (this.statusByModelId.get(modelId) === status) return
    if (!this.statusByModelId.has(modelId)) this.orderedModelIds.push(modelId)
    this.statusByModelId.set(modelId, status)
    this.emit(modelId)
  }

  replaceStatuses(statuses: readonly ModelWithStatus[]) {
    const nextStatusByModelId = new Map(statuses.map((status) => [status.model.id, status]))
    const changedModelIds = new Set<UniqueModelId>()

    for (const [modelId, status] of this.statusByModelId) {
      if (nextStatusByModelId.get(modelId) !== status) changedModelIds.add(modelId)
    }
    for (const [modelId, status] of nextStatusByModelId) {
      if (this.statusByModelId.get(modelId) !== status) changedModelIds.add(modelId)
    }

    this.statusByModelId = nextStatusByModelId
    this.orderedModelIds = statuses.map((status) => status.model.id)
    for (const modelId of changedModelIds) this.emit(modelId)
  }

  private emit(modelId: UniqueModelId) {
    for (const listener of this.listenersByModelId.get(modelId) ?? []) listener()
  }
}
