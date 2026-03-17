import type { LanguageModelMiddleware } from 'ai'

export function openrouterGenerateImageMiddleware(): LanguageModelMiddleware {
  return {
    specificationVersion: 'v3',
    transformParams: async ({ params }) => {
      const transformedParams = { ...params }
      transformedParams.providerOptions = {
        ...transformedParams.providerOptions,
        openrouter: { ...transformedParams.providerOptions?.openrouter, modalities: ['image', 'text'] }
      }
      return transformedParams
    }
  }
}
