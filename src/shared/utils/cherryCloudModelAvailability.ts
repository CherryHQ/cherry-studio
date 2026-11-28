import { isManagedCherryCloudModel } from '@shared/data/presets/cherryai'
import type { Model } from '@shared/data/types/model'
import type { CherryCloudAccountReceipt } from '@shared/ipc/schemas/cherryCloud'

type CloudModel = Pick<Model, 'id' | 'providerId'>

/**
 * Cherry Cloud's server-declared model access, shared by desktop pickers and remote catalogs.
 * Agent pickers (`includeAgentOnlyModels`) follow the server's `agent` list, others its `general` list.
 */
export function createCherryCloudModelAccess(fact: CherryCloudAccountReceipt['models'] | undefined) {
  const value = fact && fact.freshness !== 'unknown' ? fact.value : undefined
  const settled = fact?.freshness === 'fresh'
  const agentModelIds = new Set<string>(value?.availableModelIds.agent)
  const generalModelIds = new Set<string>(value?.availableModelIds.general)
  const quotaExhaustedModelIds = new Set<string>(value?.quotaExhaustedModelIds)
  /** Hidden until the first snapshot arrives, then hidden wherever the server does not enable it. */
  const isHidden = (model: CloudModel, includeAgentOnlyModels: boolean) =>
    isManagedCherryCloudModel(model.providerId) &&
    !(includeAgentOnlyModels ? agentModelIds : generalModelIds).has(model.id)
  /** Quota exhaustion only counts from a fresh snapshot. */
  const isUnavailable = (model: CloudModel) =>
    settled && isManagedCherryCloudModel(model.providerId) && quotaExhaustedModelIds.has(model.id)
  return {
    isHidden,
    isUnavailable,
    isSelectable: (model: CloudModel, includeAgentOnlyModels: boolean) =>
      !isHidden(model, includeAgentOnlyModels) && !isUnavailable(model)
  }
}
