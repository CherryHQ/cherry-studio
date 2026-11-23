import type { Assistant } from '@shared/data/types/assistant'

/** Extract user-defined request parameters from assistant settings. */
// oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- Custom JSON values and invalid-JSON fallbacks remain unvalidated; provider and SDK boundaries own their value contracts.
export function getCustomParameters(assistant: Assistant): Record<string, unknown> {
  return Object.fromEntries(
    assistant.settings?.customParameters?.flatMap((param) => {
      if (!param.name?.trim()) return []

      if (param.type === 'json') {
        const value = param.value

        if (value === 'undefined') return [[param.name, undefined]]

        try {
          return [[param.name, JSON.parse(String(value))]]
        } catch {
          return [[param.name, value]]
        }
      }

      return [[param.name, param.value]]
    }) ?? []
  )
}

/** Tag used by the response-side reasoning extraction middleware. */
export function getReasoningTagName(modelId: string | undefined): string {
  if (modelId?.includes('gpt-oss')) return 'reasoning'

  if (modelId?.includes('gemini')) return 'thought'

  if (modelId?.includes('seed-oss-36b')) return 'seed:think'

  return 'think'
}
