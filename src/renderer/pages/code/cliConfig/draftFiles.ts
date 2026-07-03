import { parseDotenv } from './dotenv'
import { parseJsonOrThrow, parseTomlOrThrow, readExternal, resolveAbs } from './file'
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
