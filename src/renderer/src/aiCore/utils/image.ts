import type { Model, Provider } from '@renderer/types'
import { isSystemProvider, SystemProviderIds } from '@renderer/types'

const OPENROUTER_GEMINI_IMAGE_MODEL_REGEX = /^google\/gemini-(?:2\.5-flash|3(?:\.\d+)?-flash)-image(?:-[\w-]+)?$/i

export function buildGeminiGenerateImageParams(): Record<string, any> {
  return {
    responseModalities: ['TEXT', 'IMAGE']
  }
}

export function isOpenRouterGeminiGenerateImageModel(model: Model, provider: Provider): boolean {
  return (
    OPENROUTER_GEMINI_IMAGE_MODEL_REGEX.test(model.id) &&
    isSystemProvider(provider) &&
    provider.id === SystemProviderIds.openrouter
  )
}
