import type { MinimalModel, MinimalProvider } from '../types'

export interface RuleSet<M extends MinimalModel = MinimalModel, P extends MinimalProvider = MinimalProvider> {
  rules: Array<{
    match: (model: M) => boolean
    provider: (provider: P) => P
  }>
  fallbackRule: (provider: P) => P
}
