import { LanguageModelMiddleware } from 'ai'

/**
 * Returns a LanguageModelMiddleware that ensures the OpenRouter provider is configured to support both
 * image and text modalities.
 * https://openrouter.ai/docs/features/multimodal/image-generation
 *
 * Remarks:
 * - The middleware declares middlewareVersion as 'v2'.
 * - transformParams asynchronously clones the incoming params and sets
 *   providerOptions.openrouter.modalities = ['image', 'text'], preserving other providerOptions and
 *   openrouter fields when present.
 * - Intended to ensure the provider can handle image and text generation without altering other
 *   parameter values.
 *
 * @returns LanguageModelMiddleware - a middleware that augments providerOptions for OpenRouter to include image and text modalities.
 */
export function openrouterGenerateImageMiddleware(): LanguageModelMiddleware {
  return {
    middlewareVersion: 'v2',

    transformParams: async ({ params }) => {
      const transformedParams = { ...params }
      transformedParams.providerOptions = {
        ...transformedParams.providerOptions,
        openrouter: { ...transformedParams.providerOptions?.openrouter, modalities: ['image', 'text'] }
      }
      transformedParams

      return transformedParams
    }
  }
}
