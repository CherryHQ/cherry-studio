import { isManagedCherryCloudModel } from '@shared/data/presets/cherryai'
import type { Model } from '@shared/data/types/model'

/** Until Cloud supplies per-surface capabilities, its catalog is Agent-only. */
export function isModelVisibleOutsideAgent(model: Pick<Model, 'providerId'>): boolean {
  return !isManagedCherryCloudModel(model.providerId)
}
