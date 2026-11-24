/**
 * Phase 1 of the agent-params pipeline: ask each active feature for its
 * contributions and gather them into a flat draft. No cross-feature
 * dependency, no mutation of scope. Phase 2 (defer exposition / system
 * prompt assembly / hook composition) reads this draft.
 *
 * Errors from any feature method are isolated — the contribution is
 * dropped, other features continue, the request still proceeds.
 */

import type { StopCondition, ToolSet } from 'ai'

import type { AiPlugin } from '@cherrystudio/ai-core'
import { loggerService } from '@logger'

import type { AgentLoopHooks } from '../loop/types'
import type { RequestFeature } from './feature'
import type { RequestScope } from './scope'

const logger = loggerService.withContext('collectFromFeatures')

export interface FeatureContributions {
  modelAdapters: AiPlugin[]
  hookParts: Array<Partial<AgentLoopHooks>>
  stopConditions: StopCondition<ToolSet>[]
}

export function collectFromFeatures(scope: RequestScope, features: readonly RequestFeature[]): FeatureContributions {
  const out: FeatureContributions = {
    modelAdapters: [],
    hookParts: [],
    stopConditions: []
  }

  for (const feature of features) {
    if (!shouldRun(feature, scope)) continue

    const modelAdapters = invokeContribution(feature, 'contributeModelAdapters', scope, feature.contributeModelAdapters)

    if (modelAdapters) out.modelAdapters.push(...modelAdapters)

    const hooks = invokeContribution(feature, 'contributeHooks', scope, feature.contributeHooks)

    if (hooks) out.hookParts.push(hooks)

    const stopConditions = invokeContribution(
      feature,
      'contributeStopConditions',
      scope,
      feature.contributeStopConditions
    )

    if (stopConditions) out.stopConditions.push(...stopConditions)
  }

  return out
}

function shouldRun(feature: RequestFeature, scope: RequestScope): boolean {
  if (!feature.applies) return true

  try {
    return feature.applies(scope)
  } catch (error) {
    logger.warn(`feature ${feature.name}.applies threw; treating as not applicable`, error)

    return false
  }
}

type ContributionMethod = 'contributeModelAdapters' | 'contributeHooks' | 'contributeStopConditions'

function invokeContribution<TResult>(
  feature: RequestFeature,
  method: ContributionMethod,
  scope: RequestScope,
  fn: ((scope: RequestScope) => TResult) | undefined
): TResult | undefined {
  if (!fn) return undefined

  try {
    return fn.call(feature, scope)
  } catch (error) {
    logger.warn(`feature ${feature.name}.${method} threw; skipping contribution`, error)

    return undefined
  }
}
