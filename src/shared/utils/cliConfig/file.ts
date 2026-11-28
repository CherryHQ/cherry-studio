import { parse as parseJsonc, type ParseError } from 'jsonc-parser'
import { parse as parseToml } from 'smol-toml'
import { type Document, isMap, isScalar, parse as parseYaml, parseDocument } from 'yaml'

import { redactSecretText } from '@shared/utils/redaction'

import type { CliConfigTarget } from './targets'

/** One CLI config file from a batch read: content === null ⇔ the file does not exist. */
export interface CliConfigReadFile {
  path: string
  content: string | null
}

/** On-disk view of a batch read, keyed by target. */
export type CliConfigReadFiles = Map<CliConfigTarget, CliConfigReadFile>

/** Batch-reads config targets; each process supplies its own transport (renderer IPC, Main disk). */
export type CliConfigFileReader = (targets: readonly CliConfigTarget[]) => Promise<CliConfigReadFiles>

/** A user-facing failure carrying an i18n key, localized by the process that displays it. */
export class CliConfigError extends Error {
  constructor(
    readonly key: string,
    readonly params: Record<string, string>
  ) {
    super(key)
    this.name = 'CliConfigError'
  }
}

/** The read entry for `target`; a missing entry is a caller bug (readConfigFiles returns every requested target). */
export function requireReadFile(target: CliConfigTarget, files: CliConfigReadFiles): CliConfigReadFile {
  const file = files.get(target)
  if (!file) throw new Error(`No read result for config target: ${target}`)
  return file
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

/** Parse JSONC from a batch read; returns null (not {}) when the file doesn't exist. */
export function readValidatedJsonOrNull(
  target: CliConfigTarget,
  files: CliConfigReadFiles,
  label: string
): Record<string, any> | null {
  const { path, content } = requireReadFile(target, files)
  return content === null ? null : parseOrThrow(content, label, path, parseJsonOrThrow)
}

/** Parse TOML from a batch read; returns null (not {}) when the file doesn't exist. */
export function readValidatedTomlOrNull(
  target: CliConfigTarget,
  files: CliConfigReadFiles,
  label: string
): Record<string, any> | null {
  const { path, content } = requireReadFile(target, files)
  return content === null ? null : parseOrThrow(content, label, path, parseTomlOrThrow)
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

export function parseYamlOrThrow(content: string, root: 'sequence'): unknown[]
export function parseYamlOrThrow(content: string): Record<string, any>
export function parseYamlOrThrow(content: string, root?: 'sequence'): Record<string, any> | unknown[] {
  try {
    const parsed = parseYaml(content, { customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: (value) => value }] })
    if (parsed == null) return root === 'sequence' ? [] : {}
    if (root === 'sequence' ? !Array.isArray(parsed) : typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`invalid YAML root: expected ${root === 'sequence' ? 'a sequence' : 'an object'}`)
    }
    return parsed
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
