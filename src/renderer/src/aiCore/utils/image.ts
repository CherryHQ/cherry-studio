import type { Model, Provider } from '@renderer/types'
import { isSystemProvider, SystemProviderIds } from '@renderer/types'

export function buildGeminiGenerateImageParams(): Record<string, any> {
  return {
    responseModalities: ['TEXT', 'IMAGE']
  }
}

export function isOpenRouterGeminiGenerateImageModel(model: Model, provider: Provider): boolean {
  return (
    model.id.includes('gemini-2.5-flash-image') &&
    isSystemProvider(provider) &&
    provider.id === SystemProviderIds.openrouter
  )
}

export function isGeminiGenerateImageModel(model: Model): boolean {
  return model.id.includes('gemini-2.5-flash-image')
}
