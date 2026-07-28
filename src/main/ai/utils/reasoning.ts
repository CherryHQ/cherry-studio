import type { Assistant } from '@shared/data/types/assistant'

/** Extract user-defined request parameters from assistant settings. */
export function getCustomParameters(assistant: Assistant): Record<string, any> {
  return (
    assistant.settings?.customParameters?.reduce<Record<string, unknown>>((acc, param) => {
      if (!param.name?.trim()) return acc

      if (param.type === 'json') {
        const value = param.value as string
        if (value === 'undefined') return { ...acc, [param.name]: undefined }
        try {
          return { ...acc, [param.name]: JSON.parse(value) }
        } catch {
          return { ...acc, [param.name]: value }
        }
      }

      return { ...acc, [param.name]: param.value }
    }, {}) ?? {}
  )
}

/** Tag used by the response-side reasoning extraction middleware. */
export function getReasoningTagName(modelId: string | undefined): string {
  if (modelId?.includes('gpt-oss')) return 'reasoning'
  if (modelId?.includes('gemini')) return 'thought'
  if (modelId?.includes('seed-oss-36b')) return 'seed:think'
  return 'think'
}
