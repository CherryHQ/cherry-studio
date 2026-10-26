import { applyEdits, format } from 'jsonc-parser'

import { getAdapter, resolveCliConfigOptionChanges, sanitizeCliConfigBlob } from './adapters'
import { parseJsonOrThrow } from './file'
import { extractConnectionFromCliConfigDraft } from './parser'
import type { CliConfigFileDraft } from './types'
import { asRecord } from './values'

export function formatCliConfigDraftFile(file: CliConfigFileDraft): CliConfigFileDraft {
  if (file.language !== 'json') return file
  parseJsonOrThrow(file.content)
  const content = applyEdits(
    file.content,
    format(file.content, undefined, { insertSpaces: true, tabSize: 2, eol: '\n' })
  )
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
