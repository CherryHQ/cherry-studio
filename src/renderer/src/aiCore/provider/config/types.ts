import type { Model, Provider } from '@renderer/types'

export interface RuleSet {
  rules: Array<{
    match: (model: Model) => boolean
    provider: (provider: Provider) => Provider
  }>
  fallbackRule: (provider: Provider) => Provider
}
