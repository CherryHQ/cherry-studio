import type { Model, Provider } from '@renderer/types'

import type { RuleSet } from './types'

export const startsWith = (prefix: string) => (model: Model) => model.id.toLowerCase().startsWith(prefix.toLowerCase())
export const endpointIs = (type: string) => (model: Model) => model.endpoint_type === type

/**
 * 解析模型对应的Provider
 * @param ruleSet 规则集对象
 * @param model 模型对象
 * @param provider 原始provider对象
 * @returns 解析出的provider对象
 */
export function provider2Provider(ruleSet: RuleSet, model: Model, provider: Provider): Provider {
  for (const rule of ruleSet.rules) {
    if (rule.match(model)) {
      return rule.provider(provider)
    }
  }
  return ruleSet.fallbackRule(provider)
}
