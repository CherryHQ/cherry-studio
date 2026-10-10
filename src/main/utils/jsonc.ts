import { parse as jsoncParse } from 'jsonc-parser'

// Keys that don't represent functional configuration content
export const NON_FUNCTIONAL_KEYS = ['$schema']

/**
 * Parse JSON with comments (JSONC) support
 * Uses jsonc-parser library for safe parsing without code execution
 */
export function parseJSONC(content: string): Record<string, any> | null {
  try {
    const result = jsoncParse(content, undefined, {
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
export function getFunctionalKeys(obj: Record<string, any>): string[] {
  return Object.keys(obj).filter((key) => !NON_FUNCTIONAL_KEYS.includes(key))
}
