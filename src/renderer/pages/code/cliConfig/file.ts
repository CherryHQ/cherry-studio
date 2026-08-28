import { ipcApi } from '@renderer/ipc'
import type { OutputFor } from '@shared/ipc/types'
import type { CliConfigTarget } from '@shared/utils/cliConfig'
import { redactSecretText } from '@shared/utils/redaction'
import { parse as parseJsonc, type ParseError } from 'jsonc-parser'
import { parse as parseToml } from 'smol-toml'
import { type Document, isMap, isScalar, parse as parseYaml, parseDocument } from 'yaml'

/** One CLI config file as read through `code_cli.read_config`: content === null ⇔ the file does not exist. */
export type CliConfigReadFile = Pick<OutputFor<'code_cli.read_config'>['files'][number], 'path' | 'content'>

/** On-disk view of a batch read, keyed by target. */
export type CliConfigReadFiles = Map<CliConfigTarget, CliConfigReadFile>

/**
 * Batch-read CLI config files through the target-enum IPC route (one round trip
 * per batch; main resolves each target's absolute path).
 */
export async function readConfigFiles(targets: readonly CliConfigTarget[]): Promise<CliConfigReadFiles> {
  if (!targets.length) return new Map()
  const { files } = await ipcApi.request('code_cli.read_config', { targets: [...targets] })
  return new Map(files.map((file) => [file.target, file]))
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
