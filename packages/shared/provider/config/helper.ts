import type { MinimalModel, MinimalProvider } from '../types'
import type { RuleSet } from './types'

export const startsWith =
  (prefix: string) =>
  <M extends MinimalModel>(model: M) =>
    model.id.toLowerCase().startsWith(prefix.toLowerCase())

export const endpointIs =
  (type: string) =>
  <M extends MinimalModel>(model: M) =>
    model.endpoint_type === type

/**
 * 解析模型对应的Provider
 * @param ruleSet 规则集对象
 * @param model 模型对象
 * @param provider 原始provider对象
 * @returns 解析出的provider对象
 */
export function provider2Provider<M extends MinimalModel, R extends MinimalProvider, P extends R = R>(
  ruleSet: RuleSet<M, R>,
  model: M,
  provider: P
): P {
  for (const rule of ruleSet.rules) {
    if (rule.match(model)) {
      return rule.provider(provider) as P
    }
  }
  return ruleSet.fallbackRule(provider) as P
}
