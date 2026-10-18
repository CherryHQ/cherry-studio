import type { PlainObject } from '../types'
import { deepMergeObjects } from '../utils'
import type { TypedProviderOptions } from './types'

/**
 * Deep-merge multiple provider-specific options.
 * Nested objects are recursively merged; primitive values are overwritten.
 *
 * When the same key appears in multiple options:
 * - If both values are plain objects: they are deeply merged (recursive merge)
 * - If values are primitives/arrays: the later value overwrites the earlier one
 *
 * @example
 * mergeProviderOptions(
 *   { openrouter: { reasoning: { enabled: true, effort: 'low' }, user: 'user-123' } },
 *   { openrouter: { reasoning: { effort: 'high', max_tokens: 500 }, models: ['gpt-4'] } }
 * )
 * // Result: {
 * //   openrouter: {
 * //     reasoning: { enabled: true, effort: 'high', max_tokens: 500 },
 * //     user: 'user-123',
 * //     models: ['gpt-4']
 * //   }
 * // }
 *
 * @param optionsMap Objects containing options for multiple providers
 * @returns Fully merged TypedProviderOptions
 */
export function mergeProviderOptions(...optionsMap: Partial<TypedProviderOptions>[]): TypedProviderOptions {
  return optionsMap.reduce<TypedProviderOptions>((acc, options) => {
    if (!options) {
      return acc
    }
    Object.entries(options).forEach(([providerId, providerOptions]) => {
      if (!providerOptions) {
        return
      }
      if (acc[providerId]) {
        acc[providerId] = deepMergeObjects(acc[providerId] as PlainObject, providerOptions as PlainObject)
      } else {
        acc[providerId] = providerOptions as any
      }
    })
    return acc
  }, {} as TypedProviderOptions)
}
