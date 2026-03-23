import type { MinimalModel, MinimalProvider } from '@shared/types'
import { getLowerBaseModelName } from '@shared/utils/naming'

import type { RuleSet } from './types'

/**
 * Create a case-insensitive matcher for model IDs that start with the given prefix.
 *
 * This helper is primarily used in [`Rule.match`](packages/shared/aiCore/config/types.ts:4)
 * to build simple prefix-based routing rules for provider adaptation.
 *
 * @param prefix The model ID prefix to match.
 * @returns A predicate function that returns true when `model.id` starts with the prefix.
 */
export const modelIdStartsWith =
  (prefix: string) =>
  <M extends MinimalModel>(model: M) =>
    model.id.toLowerCase().startsWith(prefix.toLowerCase())

/**
 * Create a matcher for a model's `endpoint_type`.
 *
 * This helper is intended for [`Rule.match`](packages/shared/aiCore/config/types.ts:4)
 * when provider resolution depends on protocol-level endpoint metadata rather than model naming.
 *
 * @param type The target endpoint type.
 * @returns A predicate function that returns true when `model.endpoint_type` matches the target type.
 */
export const endpointIs =
  (type: string) =>
  <M extends MinimalModel>(model: M) =>
    model.endpoint_type === type

/**
 * Determine whether a model should be treated as an OpenAI LLM-style model.
 *
 * The check is heuristic and based on normalized model naming patterns such as `gpt`,
 * `o1`, `o3`, `o4`, and `gpt-oss`. It is used by shared provider-resolution rules
 * rather than by any single provider implementation.
 *
 * @param model The model to inspect.
 * @returns True when the model should be handled as an OpenAI LLM-style model.
 */
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
