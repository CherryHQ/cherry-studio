import { parse as parseJsonc, type ParseError } from 'jsonc-parser'
import { parse as parseToml } from 'smol-toml'

import { redactSecretsInMessage } from './redact'

/** Resolve `~`/relative paths to absolute (renderer cannot call application.getPath). */
export async function resolveAbs(p: string): Promise<string> {
  return window.api.resolvePath(p)
}

function getParentDir(absPath: string): string | null {
  const slash = absPath.lastIndexOf('/')
  const backslash = absPath.lastIndexOf('\\')
  const index = Math.max(slash, backslash)
  if (index < 0) return null
  if (index === 0) return absPath.slice(0, 1)
  if (index === 2 && /^[A-Za-z]:[\\/]/.test(absPath)) return absPath.slice(0, 3)
  return absPath.slice(0, index)
}

export async function writeExternalConfigFile(absPath: string, content: Uint8Array | string): Promise<void> {
  const parentDir = getParentDir(absPath)
  if (parentDir) {
    await window.api.file.mkdir(parentDir)
  }
  await window.api.file.write(absPath, content, 0o600)
}

function isMissingFileError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('File does not exist') || message.includes('ENOENT')
}

/** Read an external file as text; returns null (not '') when the file is missing, throws on other read errors. */
export async function readExternalOrNull(absPath: string): Promise<string | null> {
  try {
    return await window.api.file.readExternal(absPath)
  } catch (error) {
    if (isMissingFileError(error)) return null
    throw error
  }
}

/** Read an external file as text; returns '' when missing, throws on other read errors. */
export async function readExternal(absPath: string): Promise<string> {
  return (await readExternalOrNull(absPath)) ?? ''
}

function parseOrThrow<T>(content: string, label: string, absPath: string, parseFn: (content: string) => T): T {
  try {
    return parseFn(content)
  } catch (err) {
    // parseFn (parseJsonOrThrow/parseTomlOrThrow) already redacts its own message at the source, so
    // every caller — this wrapper, validateCliConfigDraftForWrite, draftUpdater.ts — is covered.
    const rawMessage = err instanceof Error ? err.message : String(err)
    throw new Error(`Failed to parse ${label} at ${absPath}: ${rawMessage}`)
  }
}

/** Read + parse JSONC, throwing a contextual error on a malformed file. */
export async function readValidatedJson(absPath: string, label: string): Promise<Record<string, any>> {
  return parseOrThrow(await readExternal(absPath), label, absPath, parseJsonOrThrow)
}

/** Read + parse TOML, throwing a contextual error on a malformed file. */
export async function readValidatedToml(absPath: string, label: string): Promise<Record<string, any>> {
  return parseOrThrow(await readExternal(absPath), label, absPath, parseTomlOrThrow)
}

/** Like readValidatedJson, but returns null (instead of {}) when the file doesn't exist. */
export async function readValidatedJsonOrNull(absPath: string, label: string): Promise<Record<string, any> | null> {
  const content = await readExternalOrNull(absPath)
  return content === null ? null : parseOrThrow(content, label, absPath, parseJsonOrThrow)
}

/** Like readValidatedToml, but returns null (instead of {}) when the file doesn't exist. */
export async function readValidatedTomlOrNull(absPath: string, label: string): Promise<Record<string, any> | null> {
  const content = await readExternalOrNull(absPath)
  return content === null ? null : parseOrThrow(content, label, absPath, parseTomlOrThrow)
}

export function parseTomlOrThrow(content: string): Record<string, any> {
  if (!content) return {}
  try {
    return parseToml(content) as Record<string, any>
  } catch (err) {
    // smol-toml embeds a source codeblock (the offending line +/- 1) straight into its own message,
    // so this must be redacted right here — every call site (direct or through parseOrThrow) inherits it.
    const rawMessage = err instanceof Error ? err.message : String(err)
    throw new Error(redactSecretsInMessage(rawMessage))
  }
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
