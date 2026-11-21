import type { JSONObject, JSONValue } from '@ai-sdk/provider'

import type { TypedProviderOptions } from './types'

const isPlainObject = (value: JSONValue | undefined): value is JSONObject => {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function deepMergeObjects(target: JSONObject, source: JSONObject): JSONObject {
  const result: JSONObject = { ...target }
  Object.entries(source).forEach(([key, value]) => {
    const merged =
      Object.hasOwn(result, key) && isPlainObject(value) && isPlainObject(result[key])
        ? deepMergeObjects(result[key], value)
        : value
    Object.defineProperty(result, key, { value: merged, enumerable: true, configurable: true, writable: true })
  })
  return result
}

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
      const merged =
        Object.hasOwn(acc, providerId) && acc[providerId]
          ? deepMergeObjects(acc[providerId], providerOptions)
          : providerOptions
      Object.defineProperty(acc, providerId, { value: merged, enumerable: true, configurable: true, writable: true })
    })
    return acc
  }, {})
}
