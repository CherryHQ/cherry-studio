import { parse as jsoncParse } from 'jsonc-parser'

import type { Serializable } from '@shared/types/serializable'

// Keys that don't represent functional configuration content
export const NON_FUNCTIONAL_KEYS = ['$schema']

/**
 * Parse JSON with comments (JSONC) support
 * Uses jsonc-parser library for safe parsing without code execution
 * @returns The parser's object or array result, or null when neither is produced.
 */
export function parseJSONC(content: string): Record<string, Serializable> | Serializable[] | null {
  try {
    const result: Serializable | undefined = jsoncParse(content, undefined, {
      allowTrailingComma: true,
      disallowComments: false
    })

    return result && typeof result === 'object' ? result : null
  } catch {
    return null
  }
}

/**
 * Get functional keys from a config object (excluding non-functional keys like $schema)
 */
// oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- Only key names are inspected; configuration values remain opaque.
export function getFunctionalKeys(obj: Record<string, unknown>): string[] {
  return Object.keys(obj).filter((key) => !NON_FUNCTIONAL_KEYS.includes(key))
}
