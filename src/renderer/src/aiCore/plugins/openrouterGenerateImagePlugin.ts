import { definePlugin } from '@cherrystudio/ai-core'
import type { LanguageModelMiddleware } from 'ai'

/**
 * Returns a LanguageModelMiddleware that ensures the OpenRouter provider is configured to support both
 * image and text modalities.
 * https://openrouter.ai/docs/features/multimodal/image-generation
 *
 * Remarks:
 * - The middleware declares specificationVersion as 'v3'.
 * - transformParams asynchronously clones the incoming params and sets
 *   providerOptions.openrouter.modalities = ['image', 'text'], preserving other providerOptions and
 *   openrouter fields when present.
 * - Intended to ensure the provider can handle image and text generation without altering other
 *   parameter values.
 *
 * @returns LanguageModelMiddleware - a middleware that augments providerOptions for OpenRouter to include image and text modalities.
 */
function createOpenrouterGenerateImageMiddleware(): LanguageModelMiddleware {
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

export const createOpenrouterGenerateImagePlugin = () =>
  definePlugin({
    name: 'openrouterGenerateImage',
    enforce: 'pre',

    configureContext: (context) => {
      context.middlewares = context.middlewares || []
      context.middlewares.push(createOpenrouterGenerateImageMiddleware())
    }
  })
