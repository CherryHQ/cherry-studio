import type { TypedProviderOptions } from './types'

// oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- SDK-specific options include opaque fields such as Anthropic fallback thinking/output_config; merging preserves their values without recursively validating them as JSON.
type ProviderOptionObject = Record<string, unknown>

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Nested SDK option values can be opaque; only distinguish mergeable objects from scalars and arrays here.
const isPlainObject = (value: unknown): value is ProviderOptionObject => {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function deepMergeObjects(target: ProviderOptionObject, source: ProviderOptionObject): ProviderOptionObject {
  // oxlint-disable-next-line anti-slop/no-known-value-widening -- This merge container preserves opaque SDK values; cloning it does not validate those fields as JSON or a closed shape.
  const result: ProviderOptionObject = { ...target }
  Object.entries(source).forEach(([key, value]) => {
    const merged =
      Object.prototype.hasOwnProperty.call(result, key) && isPlainObject(value) && isPlainObject(result[key])
        ? deepMergeObjects(result[key], value)
        : value

    Object.defineProperty(result, key, { value: merged, enumerable: true, configurable: true, writable: true })
  })

  // oxlint-disable-next-line anti-slop/no-known-value-widening -- Merging preserves opaque nested SDK values; the result does not certify a closed or JSON-only shape.
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
        Object.prototype.hasOwnProperty.call(acc, providerId) && acc[providerId]
          ? deepMergeObjects(acc[providerId], providerOptions)
          : providerOptions

      Object.defineProperty(acc, providerId, { value: merged, enumerable: true, configurable: true, writable: true })
    })

    return acc
  }, {})
}
