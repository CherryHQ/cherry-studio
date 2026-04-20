import { parse } from 'dotenv'

export const parseKeyValueString = (str: string): Record<string, string> => {
  return parse(str)
}

/**
 * Serialize a Record to a dotenv-compatible KEY=value string.
 *
 * Quoting strategy (dotenv does NOT unescape `\"` or `\\`):
 * - Unquoted: safe for most values including those with `"` or `\`
 * - Single-quoted: literal (no escaping), for `#`/whitespace/multiline values
 * - Backtick-quoted: literal fallback when value contains single quotes
 */
export const serializeKeyValueString = (vars: Record<string, string>): string =>
  Object.entries(vars)
    .map(([k, v]) => {
      const needsQuoting = v.includes('#') || v.includes('\n') || v !== v.trim()
      if (!needsQuoting) return `${k}=${v}`
      // Prefer single quotes (literal, no escaping needed in dotenv)
      if (!v.includes("'")) return `${k}='${v}'`
      // Fall back to backtick quotes (also literal in dotenv, supports multiline)
      if (!v.includes('`')) return `${k}=\`${v}\``
      // All three quote types present — best-effort backtick quoting.
      // Lossy only if value also contains backticks, which is essentially
      // non-existent in real environment variables.
      return `${k}=\`${v}\``
    })
    .join('\n')
