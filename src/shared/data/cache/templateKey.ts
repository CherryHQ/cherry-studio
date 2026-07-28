import type { SharedCacheSchema } from './cacheSchemas'
import { DefaultSharedCache } from './cacheSchemas'

/**
 * Checks if a schema key is a template key (contains `${...}` placeholder).
 *
 * @example
 * ```ts
 * isTemplateKey('scroll.position.${id}')  // true
 * isTemplateKey('app.user.avatar')        // false
 * ```
 */
export function isTemplateKey(key: string): boolean {
  return key.includes('${') && key.includes('}')
}

/**
 * Converts a template key pattern into a RegExp for matching concrete keys.
 *
 * Each `${variable}` placeholder expands to `([\w\-]+)` — matches the same
 * character set permitted by the cache key naming convention (ASCII word
 * chars plus hyphens). Non-ASCII characters, dots, and colons are rejected
 * by design: this keeps the subscription layer aligned with the `data-schema-key/valid-key`
 * ESLint rule. The placeholder variable name itself is ignored at runtime.
 *
 * @example
 * ```ts
 * const regex = templateToRegex('scroll.position.${id}')
 * regex.test('scroll.position.topic123')   // true
 * regex.test('scroll.position.topic-123')  // true
 * regex.test('scroll.position.')           // false
 * regex.test('other.key.123')              // false
 * ```
 */
export function templateToRegex(template: string): RegExp {
  const escaped = template.replace(/[.*+?^${}()|[\]\\]/g, (match) => {
    if (match === '$' || match === '{' || match === '}') {
      return match
    }
    return '\\' + match
  })

  const pattern = escaped.replace(/\$\{[^}]+\}/g, '([\\w\\-]+)')

  return new RegExp(`^${pattern}$`)
}

/**
 * Finds the shared schema key that matches a given concrete key.
 *
 * Returns the exact schema key (fixed or template pattern), not the concrete
 * instance — callers use it to look up the template's default value.
 */
export function findMatchingSharedCacheSchemaKey(key: string): keyof SharedCacheSchema | undefined {
  if (key in DefaultSharedCache) {
    return key as keyof SharedCacheSchema
  }

  const schemaKeys = Object.keys(DefaultSharedCache) as Array<keyof SharedCacheSchema>
  for (const schemaKey of schemaKeys) {
    if (isTemplateKey(schemaKey as string)) {
      const regex = templateToRegex(schemaKey as string)
      if (regex.test(key)) {
        return schemaKey
      }
    }
  }

  return undefined
}
