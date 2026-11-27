import { applyEdits, format } from 'jsonc-parser'

import { getAdapter, resolveCliConfigOptionChanges, sanitizeCliConfigBlob } from '@shared/utils/cliConfig'
import { parseJsonOrThrow } from '@shared/utils/cliConfig'
import type { CliConfigFileDraft } from '@shared/utils/cliConfig'
import { asRecord } from '@shared/utils/cliConfig'

import { extractConnectionFromCliConfigDraft } from './parser'

export function formatCliConfigDraftFile(file: CliConfigFileDraft): CliConfigFileDraft {
  if (file.language !== 'json') return file
  parseJsonOrThrow(file.content)
  const source = file.content.replace(/\r\n?/g, '\n')
  const content = applyEdits(source, format(source, undefined, { insertSpaces: true, tabSize: 2, eol: '\n' }))
  return { ...file, content: `${content.trimEnd()}\n` }
}

export function updateCliConfigDraftConfig(
  cliTool: string,
  files: CliConfigFileDraft[],
  configBlob: Record<string, unknown>
): CliConfigFileDraft[] {
  const connection = extractConnectionFromCliConfigDraft(cliTool, files)
  const blob = sanitizeCliConfigBlob(cliTool, asRecord(configBlob))
  if (!connection) return files
  const adapter = getAdapter(cliTool)
  if (!adapter) return files
  return adapter.updateDraftConfig(files, connection, resolveCliConfigOptionChanges(cliTool, files, blob))
}
