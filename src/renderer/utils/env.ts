import { parse } from 'dotenv'

export const parseKeyValueString = (str: string): Record<string, string> => {
  return parse(str)
}

/**
 * Serialize a Record to a dotenv-compatible KEY=value string.
 *
 * Quoting strategy (dotenv does NOT unescape `\"`, `\'`, `` \` `` or `\\`):
 * - Unquoted: safe for most values including those with `"` or `\`
 * - Single-quoted: literal (no escaping), for `#`/quote/whitespace/multiline values
 * - Backtick-quoted: literal fallback when value contains single quotes
 * - Double-quoted: for values holding both `'` and `` ` `` (dotenv only expands `\n`/`\r` in it)
 */
export const serializeKeyValueString = (vars: Record<string, string>): string =>
  Object.entries(vars)
    .map(([k, raw]) => {
      // Rows migrated from v1 DXT imports were never validated and can hold non-string values.
      const v = String(raw)
      // A bare value wrapped in backticks would be read back as a quoted one, hence the backtick here.
      const needsQuoting = /[\n\r"'`#]/.test(v) || v !== v.trim()
      if (!needsQuoting) return `${k}=${v}`
      // Prefer single quotes (literal, no escaping needed in dotenv)
      if (!v.includes("'")) return `${k}='${v}'`
      // Fall back to backtick quotes (also literal in dotenv, supports multiline)
      if (!v.includes('`')) return `${k}=\`${v}\``
      // Double quotes are literal too except for `\n`/`\r` escapes, so keep backslashes out of them.
      if (!v.includes('"') && !v.includes('\\')) return `${k}="${v}"`
      // All three quote types present: best-effort backtick quoting, lossy at the inner backticks.
      return `${k}=\`${v}\``
    })
    .join('\n')
