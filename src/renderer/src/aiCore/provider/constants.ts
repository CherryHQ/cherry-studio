import type { Model } from '@renderer/types'

export const COPILOT_EDITOR_VERSION = 'vscode/1.104.1'

export const COPILOT_DEFAULT_HEADERS = {
  'editor-version': COPILOT_EDITOR_VERSION,
  'copilot-vision-request': 'true'
} as const

// Models that require the OpenAI Responses endpoint when routed through GitHub Copilot (#10560)
const COPILOT_RESPONSES_MODEL_IDS = ['gpt-5-codex']

export function isCopilotResponsesModel(model: Model): boolean {
  const normalizedId = model.id?.trim().toLowerCase()
  const normalizedName = model.name?.trim().toLowerCase()
  return COPILOT_RESPONSES_MODEL_IDS.some((target) => normalizedId === target || normalizedName === target)
}
