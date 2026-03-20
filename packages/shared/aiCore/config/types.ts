import type { MinimalModel, MinimalProvider } from '@shared/types'

export interface Rule<M extends MinimalModel = MinimalModel, P extends MinimalProvider = MinimalProvider> {
  match: (model: M) => boolean
  provider: <T extends P>(provider: T) => T
}

export interface RuleSet<M extends MinimalModel = MinimalModel, P extends MinimalProvider = MinimalProvider> {
  /**
   * Rules are evaluated in declaration order.
   * The first matching rule wins.
   */
  rules: Array<Rule<M, P>>
  fallbackRule: <T extends P>(provider: T) => T
}
