import { getAdapter, sanitizeCliConfigBlob } from './adapters'
import { parseJsonOrThrow, renderJsonFile } from './file'
import { extractConnectionFromCliConfigDraft } from './parser'
import type { CliConfigFileDraft } from './types'
import { asRecord } from './values'

export function formatCliConfigDraftFile(file: CliConfigFileDraft): CliConfigFileDraft {
  if (file.language !== 'json') return file
  return { ...file, content: renderJsonFile(parseJsonOrThrow(file.content)) }
}

export function updateCliConfigDraftConfig(
  cliTool: string,
  files: CliConfigFileDraft[],
  configBlob: Record<string, unknown>
): CliConfigFileDraft[] {
  const connection = extractConnectionFromCliConfigDraft(cliTool, files)
  const blob = sanitizeCliConfigBlob(cliTool, asRecord(configBlob))
  if (!connection) return files
  return getAdapter(cliTool)?.updateDraftConfig(files, connection, blob) ?? files
}
