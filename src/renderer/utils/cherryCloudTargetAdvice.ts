import { isManagedCherryCloudModel } from '@shared/data/presets/cherryai'
import { type Model, type UniqueModelId, parseUniqueModelId } from '@shared/data/types/model'

/** Per-target quota advice; no-known-obstacle grants no entitlement or permission. */
export interface CherryCloudTargetAdvice {
  targetId: UniqueModelId
  state: 'unknown' | 'no-known-obstacle' | 'known-exhausted'
}

interface TargetFacts {
  freshness: 'unknown' | 'fresh' | 'stale'
  isModelUnavailable: (model: Pick<Model, 'id' | 'providerId'>) => boolean
}

/** Advises quota only. Entitlement/use-case authorization remains with the request owner; unresolved targets stay unknown. */
export function getCherryCloudTargetAdvice(
  targetIds: readonly UniqueModelId[] | undefined,
  facts: TargetFacts
): readonly CherryCloudTargetAdvice[] | undefined {
  return targetIds?.map((targetId) => {
    const { providerId } = parseUniqueModelId(targetId)
    const state = !isManagedCherryCloudModel(providerId)
      ? 'no-known-obstacle'
      : facts.freshness !== 'fresh'
        ? 'unknown'
        : facts.isModelUnavailable({ id: targetId, providerId })
          ? 'known-exhausted'
          : 'no-known-obstacle'
    return { targetId, state }
  })
}

export function hasKnownExhaustedTarget(advice: readonly CherryCloudTargetAdvice[] | undefined): boolean {
  return advice?.some((target) => target.state === 'known-exhausted') ?? false
}
