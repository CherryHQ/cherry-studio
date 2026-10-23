import { modelMatchId } from '../utils/modelMatchId'
import { stripDateSnapshot } from '../utils/normalize'
import { REQUEST_POLICIES } from './request-policies.gen'

/** Exact provider aliases precede catalog IDs; release dates do not erase sizes or semantic variants. */
export function getModelRequestPolicies(modelId: string, providerId?: string) {
  const id = modelMatchId(modelId)
  const releaseId = stripDateSnapshot(id)
  return (
    (providerId
      ? (REQUEST_POLICIES[`${providerId}/${id}`] ?? REQUEST_POLICIES[`${providerId}/${releaseId}`])
      : undefined) ??
    REQUEST_POLICIES[id] ??
    REQUEST_POLICIES[releaseId]
  )
}
