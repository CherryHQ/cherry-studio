import { parse as parseJsonc, type ParseError } from 'jsonc-parser'
import { parse as parseToml } from 'smol-toml'

/** Resolve `~`/relative paths to absolute (renderer cannot call application.getPath). */
export async function resolveAbs(p: string): Promise<string> {
  return window.api.resolvePath(p)
}

/** Read an external file as text; returns '' when missing or unreadable. */
export async function readExternal(absPath: string): Promise<string> {
  try {
    return await window.api.file.readExternal(absPath)
  } catch {
    return ''
  }
}

/** Read + parse JSONC, throwing a contextual error on a malformed file. */
export async function readValidatedJson(absPath: string, label: string): Promise<Record<string, any>> {
  try {
    return parseJsonOrThrow(await readExternal(absPath))
  } catch (err) {
    throw new Error(`Failed to parse ${label} at ${absPath}: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/** Read + parse TOML, throwing a contextual error on a malformed file. */
export async function readValidatedToml(absPath: string, label: string): Promise<Record<string, any>> {
  try {
    return parseTomlOrThrow(await readExternal(absPath))
  } catch (err) {
    throw new Error(`Failed to parse ${label} at ${absPath}: ${err instanceof Error ? err.message : String(err)}`)
  }
}

export function parseTomlOrThrow(content: string): Record<string, any> {
  if (!content) return {}
  return parseToml(content) as Record<string, any>
}

export function parseJsonOrThrow(content: string): Record<string, any> {
  if (!content) return {}
  const errors: ParseError[] = []
  const parsed = parseJsonc(content, errors, { allowTrailingComma: true, disallowComments: false })
  if (errors.length) {
    throw new Error(`invalid JSONC (${errors.length} parse error(s))`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('invalid JSONC root: expected an object')
  }
  return parsed as Record<string, any>
}

export function renderJsonFile(value: Record<string, any>): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

export function renderDotenvFile(envMap: Map<string, string>): string {
  return `${[...envMap.entries()].map(([key, value]) => `${key}=${value}`).join('\n')}\n`
}
