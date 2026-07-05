import { parseDotenv } from './dotenv'
import { parseJsonOrThrow, parseTomlOrThrow, readExternal, resolveAbs } from './file'
import { redactSecretsInMessage } from './redact'
import { CLI_CONFIG_FILE_SPECS } from './targets'
import type { CliConfigFileDraft, CliConfigTarget } from './types'

export function getDraftFile(
  files: CliConfigFileDraft[] | undefined,
  target: CliConfigTarget
): CliConfigFileDraft | undefined {
  return files?.find((file) => file.target === target)
}

export async function makeDraftFile(target: CliConfigTarget, content: string): Promise<CliConfigFileDraft> {
  const spec = CLI_CONFIG_FILE_SPECS[target]
  return {
    target,
    label: spec.label,
    path: await resolveAbs(spec.path),
    language: spec.language,
    content
  }
}

export async function readDraftFileText(target: CliConfigTarget, files?: CliConfigFileDraft[]): Promise<string> {
  const draft = getDraftFile(files, target)
  if (draft) return draft.content
  const spec = CLI_CONFIG_FILE_SPECS[target]
  return readExternal(await resolveAbs(spec.path))
}

/** Read + parse a draft/on-disk config file, wrapping a parse failure with the file's label and path. */
export async function readAndParseDraftFile<T>(
  target: CliConfigTarget,
  parseFn: (content: string) => T,
  files?: CliConfigFileDraft[]
): Promise<T> {
  const content = await readDraftFileText(target, files)
  try {
    return parseFn(content)
  } catch (err) {
    const spec = CLI_CONFIG_FILE_SPECS[target]
    const path = getDraftFile(files, target)?.path ?? (await resolveAbs(spec.path))
    const rawMessage = err instanceof Error ? err.message : String(err)
    throw new Error(`Failed to parse ${spec.label} at ${path}: ${redactSecretsInMessage(rawMessage)}`)
  }
}

function parseDraftFile(file: CliConfigFileDraft): Record<string, any> | Map<string, string> {
  switch (file.language) {
    case 'json':
      return parseJsonOrThrow(file.content)
    case 'toml':
      return parseTomlOrThrow(file.content)
    case 'dotenv':
      return parseDotenv(file.content)
  }
}

export function validateCliConfigDraftForWrite(files: CliConfigFileDraft[]): void {
  for (const file of files) parseDraftFile(file)
}
