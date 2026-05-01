/**
 * Phase 1 of the agent-params pipeline: ask each active feature for its
 * contributions and gather them into a flat draft. No cross-feature
 * dependency, no mutation of scope. Phase 2 (defer exposition / system
 * prompt assembly / hook composition) reads this draft.
 *
 * Errors from any feature method are isolated — the contribution is
 * dropped, other features continue, the request still proceeds.
 */

import type { AiPlugin } from '@cherrystudio/ai-core'
import { loggerService } from '@logger'

import type { ToolEntry } from '../../tools/types'
import type { AgentLoopHooks } from '../loop'
import type { RequestFeature } from './feature'
import type { RequestScope } from './scope'

const logger = loggerService.withContext('collectFromFeatures')

export interface FeatureContributions {
  /** Ephemeral tool entries from feature.contributeTools — does NOT include
   *  registry-resident tools, the orchestrator merges those separately. */
  ephemeralEntries: ToolEntry[]
  systemSections: Array<{ key: string; text: string }>
  modelAdapters: AiPlugin[]
  hookParts: Array<Partial<AgentLoopHooks>>
}

export function collectFromFeatures(scope: RequestScope, features: readonly RequestFeature[]): FeatureContributions {
  const out: FeatureContributions = {
    ephemeralEntries: [],
    systemSections: [],
    modelAdapters: [],
    hookParts: []
  }

  for (const feature of features) {
    if (!shouldRun(feature, scope)) continue

    const ephemeralEntries = invokeContribution(feature, 'contributeTools', scope)
    if (ephemeralEntries) out.ephemeralEntries.push(...ephemeralEntries)

    const systemSection = invokeContribution(feature, 'contributeSystemSection', scope)
    if (systemSection) out.systemSections.push(systemSection)

    const modelAdapters = invokeContribution(feature, 'contributeModelAdapters', scope)
    if (modelAdapters) out.modelAdapters.push(...modelAdapters)

    const hooks = invokeContribution(feature, 'contributeHooks', scope)
    if (hooks) out.hookParts.push(hooks)
  }

  return out
}

function shouldRun(feature: RequestFeature, scope: RequestScope): boolean {
  if (!feature.applies) return true
  try {
    return feature.applies(scope)
  } catch (error) {
    logger.warn(`feature ${feature.name}.applies threw; treating as not applicable`, error as Error)
    return false
  }
}

type ContributionMethod = 'contributeTools' | 'contributeSystemSection' | 'contributeModelAdapters' | 'contributeHooks'

function invokeContribution<M extends ContributionMethod>(
  feature: RequestFeature,
  method: M,
  scope: RequestScope
): ReturnType<NonNullable<RequestFeature[M]>> | undefined {
  const fn = feature[method] as ((scope: RequestScope) => ReturnType<NonNullable<RequestFeature[M]>>) | undefined
  if (!fn) return undefined
  try {
    return fn.call(feature, scope)
  } catch (error) {
    logger.warn(`feature ${feature.name}.${method} threw; skipping contribution`, error as Error)
    return undefined
  }
}
