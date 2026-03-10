import { parse } from 'dotenv'

export const parseKeyValueString = (str: string): Record<string, string> => {
  return parse(str)
}

/**
 * Serialize a Record to a dotenv-compatible KEY=value string.
 *
 * Quoting strategy (dotenv does NOT unescape `\"` or `\\`):
 * - Unquoted: safe for most values including those with `"` or `\`
 * - Single-quoted: literal (no escaping), used for values with `#` or whitespace
 * - Double-quoted: used for multiline values (dotenv handles embedded newlines)
 */
export const serializeKeyValueString = (vars: Record<string, string>): string =>
  Object.entries(vars)
    .map(([k, v]) => {
      if (v.includes('\n')) {
        // Multiline values require double quotes in dotenv format
        return `${k}="${v}"`
      }
      if (v.includes('#') || v !== v.trim()) {
        // Prefer single quotes (literal, no escaping needed in dotenv)
        if (!v.includes("'")) return `${k}='${v}'`
        // Fall back to double quotes if value contains single quotes
        return `${k}="${v}"`
      }
      return `${k}=${v}`
    })
    .join('\n')
