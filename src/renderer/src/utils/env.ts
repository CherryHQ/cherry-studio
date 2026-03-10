import { parse } from 'dotenv'

export const parseKeyValueString = (str: string): Record<string, string> => {
  return parse(str)
}

/**
 * Serialize a Record to a dotenv-compatible KEY=value string.
 * Values containing `#`, newlines, or leading/trailing whitespace are
 * wrapped in double quotes so that `parseKeyValueString` round-trips losslessly.
 */
export const serializeKeyValueString = (vars: Record<string, string>): string =>
  Object.entries(vars)
    .map(([k, v]) => {
      const needsQuoting = v.includes('#') || v.includes('\n') || v.includes('"') || v !== v.trim()
      return needsQuoting ? `${k}="${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : `${k}=${v}`
    })
    .join('\n')
