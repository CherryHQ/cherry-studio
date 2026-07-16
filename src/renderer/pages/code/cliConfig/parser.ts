import { getAdapter } from './adapters'
import type { CliConfigConnection, CliConfigFileDraft } from './types'

export function extractConnectionFromCliConfigDraft(
  cliTool: string,
  files: CliConfigFileDraft[]
): CliConfigConnection | null {
  const connection = extractConnectionFromCliConfigDraftInternal(cliTool, files)
  if (!connection) return null
  // An existing-but-empty config file (e.g. `{}`) parses to an all-undefined connection object,
  // which is truthy — callers doing `if (!connection)` would otherwise misread it as a real,
  // non-matching foreign connection instead of "no connection info here".
  return connection.baseUrl || connection.apiKey || connection.model ? connection : null
}

function extractConnectionFromCliConfigDraftInternal(
  cliTool: string,
  files: CliConfigFileDraft[]
): CliConfigConnection | null {
  try {
    return getAdapter(cliTool)?.extractConnection(files) ?? null
  } catch {
    return null
  }
}

export function extractConfigFromCliConfigDraft(
  cliTool: string,
  files: CliConfigFileDraft[]
): Record<string, unknown> | null {
  try {
    return getAdapter(cliTool)?.extractConfig(files) ?? null
  } catch {
    return null
  }
}
