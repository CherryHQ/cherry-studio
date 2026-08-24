import { redactSecretText } from '@shared/utils/redaction'
import { parse as parseJsonc, type ParseError } from 'jsonc-parser'
import { parse as parseToml } from 'smol-toml'
import { type Document, isMap, isScalar, parse as parseYaml, parseDocument } from 'yaml'

/** Resolve `~`/relative paths to absolute (renderer cannot call application.getPath). */
export async function resolveAbs(p: string): Promise<string> {
  return window.api.resolvePath(p)
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
    // Safe to embed: parseTomlOrThrow redacts its message at the source, and
    // parseJsonOrThrow's messages carry no file content (only an error count) —
    // if it ever starts embedding source, it must redact like the TOML parser.
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
    throw new Error(redactSecretText(rawMessage))
  }
}

export function parseYamlOrThrow(content: string): Record<string, any> {
  if (!content) return {}
  try {
    const parsed = parseYaml(content)
    if (parsed == null) return {}
    if (typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('invalid YAML root: expected an object')
    }
    return parsed as Record<string, any>
  } catch (err) {
    const rawMessage = err instanceof Error ? err.message : String(err)
    throw new Error(redactSecretText(rawMessage))
  }
}

/** Parse a user-owned YAML mapping without discarding its comments or presentation. */
export function parseYamlDocumentOrThrow(content: string): Document {
  try {
    const document = parseDocument(content)
    if (document.errors.length > 0) throw document.errors[0]
    const root = document.contents
    if (root === null || (isScalar(root) && root.value === null)) {
      const mapping = document.createNode({})
      if (root && isScalar(root)) {
        mapping.comment = root.comment
        mapping.commentBefore = root.commentBefore
      }
      document.contents = mapping as unknown as typeof document.contents
    }
    if (!isMap(document.contents)) throw new Error('invalid YAML root: expected an object')
    return document
  } catch (err) {
    const rawMessage = err instanceof Error ? err.message : String(err)
    throw new Error(redactSecretText(rawMessage))
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
