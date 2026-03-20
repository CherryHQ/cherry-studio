import type { MinimalModel, MinimalProvider } from '@shared/types'
import { getLowerBaseModelName } from '@shared/utils/naming'

import type { RuleSet } from './types'

export const modelIdStartsWith =
  (prefix: string) =>
  <M extends MinimalModel>(model: M) =>
    model.id.toLowerCase().startsWith(prefix.toLowerCase())

export const endpointIs =
  (type: string) =>
  <M extends MinimalModel>(model: M) =>
    model.endpoint_type === type

export function isOpenAILLMModel<M extends MinimalModel>(model: M): boolean {
  const modelId = getLowerBaseModelName(model.id)
  const reasonings = ['o1', 'o3', 'o4', 'gpt-oss']
  if (reasonings.some((r) => modelId.includes(r))) {
    return true
  }
  if (modelId.includes('gpt')) {
    return true
  }
  return false
}

/**
 * 解析模型对应的Provider
 * @param ruleSet 规则集对象
 * @param model 模型对象
 * @param provider 原始provider对象
 * @returns 解析出的provider对象
 */
export function provider2Provider<M extends MinimalModel, P extends MinimalProvider>(
  ruleSet: RuleSet<M, MinimalProvider>,
  model: M,
  provider: P
): P {
  /**
   * Rules are matched in order and the first matched rule wins.
   * Rule authors should place more specific rules before generic ones.
   */
  for (const rule of ruleSet.rules) {
    if (rule.match(model)) {
      return rule.provider(provider)
    }
  }
  return ruleSet.fallbackRule(provider)
}
