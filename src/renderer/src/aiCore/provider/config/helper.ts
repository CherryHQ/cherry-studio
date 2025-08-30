import type { Model, Provider } from '@renderer/types'

import type { ModelRule } from './types'

export const startsWith = (prefix: string) => (model: Model) => model.id.toLowerCase().startsWith(prefix.toLowerCase())
export const endpointIs = (type: string) => (model: Model) => model.endpoint_type === type

/**
 * 解析模型对应的Provider ID
 * @param model 模型对象
 * @param rules 匹配规则数组
 * @param fallback 默认fallback的providerId
 * @returns 解析出的providerId
 */
export function provider2Provider(rules: ModelRule[], model: Model, provider: Provider): Provider {
  for (const rule of rules) {
    if (rule.match(model)) {
      return rule.provider(provider)
    }
  }
  return provider
}
