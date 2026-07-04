import type { ConfigDraft } from './types'

function normalizeDraftForDirtyCheck(draft: ConfigDraft) {
  return {
    modelId: draft.modelId,
    config: draft.config,
    files: draft.files.map((file) => ({
      target: file.target,
      label: file.label,
      path: file.path,
      language: file.language,
      content: file.content
    })),
    mode: draft.mode
  }
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue)
  if (!value || typeof value !== 'object') return value

  return Object.fromEntries(
    Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => [key, sortJsonValue(entry)])
  )
}

export function createDraftSnapshot(draft: ConfigDraft): string {
  return JSON.stringify(sortJsonValue(normalizeDraftForDirtyCheck(draft)))
}
