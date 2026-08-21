import type { DataApiDataChangeEffect } from '@shared/data/api/types'

import type { DataApiEffectCollector } from './types'

interface EffectScopeResult<Result> {
  result: Result
  committedEffects?: DataApiDataChangeEffect[]
}

export class DataApiEffectScope {
  private activeEffects: DataApiDataChangeEffect[] | undefined

  collect<Result>(run: (effects: DataApiEffectCollector) => Result): EffectScopeResult<Result> {
    const effects = this.activeEffects ?? []
    const isOutermost = this.activeEffects === undefined
    const checkpoint = effects.length
    if (isOutermost) this.activeEffects = effects

    try {
      const result = run({ add: (effect) => effects.push(effect) })
      return { result, ...(isOutermost ? { committedEffects: this.dedupe(effects) } : {}) }
    } catch (error) {
      effects.length = checkpoint
      throw error
    } finally {
      if (isOutermost) this.activeEffects = undefined
    }
  }

  private dedupe(effects: readonly DataApiDataChangeEffect[]): DataApiDataChangeEffect[] {
    const unique = new Map<string, DataApiDataChangeEffect>()
    for (const effect of effects) {
      const routeParams = effect.routeParams
        ? Object.fromEntries(Object.entries(effect.routeParams).sort(([left], [right]) => left.localeCompare(right)))
        : undefined
      const key = JSON.stringify({ ...effect, routeParams })
      if (!unique.has(key)) unique.set(key, effect)
    }
    return [...unique.values()]
  }
}
