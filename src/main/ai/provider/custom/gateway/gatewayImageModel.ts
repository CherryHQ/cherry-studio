/**
 * Language→image adapter for Gemini "chat 出图" models on the Vercel AI
 * Gateway (`gateway` provider).
 *
 * Gemini image models (`gemini-3-pro-image`, `gemini-2.5-flash-image`, …) have
 * no dedicated image endpoint — they emit images through the language
 * `generateContent` API with `responseModalities: ['IMAGE']`. `@ai-sdk/google`
 * hides this behind an internal `ImageModelV3` adapter
 * (`GoogleGenerativeAIImageModel.doGenerateGemini`), but `@ai-sdk/gateway`'s
 * `imageModel()` is a thin proxy to the gateway's `/image-model` route, which
 * rejects these models as "a language model, not an image model".
 *
 * This file ports that same adapter, wrapping the gateway's own
 * `languageModel()` (the only thing that speaks the gateway protocol) instead
 * of Google's. The aihubmix / cherryin meta-providers solve the equivalent
 * problem by pointing a real `@ai-sdk/google` provider at their Google-native
 * endpoint — the gateway has no such endpoint, so it needs this.
 */
import type { ImageModelV3, ImageModelV3CallOptions, JSONValue, LanguageModelV3 } from '@ai-sdk/provider'
import { convertToBase64 } from '@ai-sdk/provider-utils'

const GATEWAY_GOOGLE_IMAGE_PROVIDER = 'gateway.google.image' as const

/**
 * Gemini chat-image model under the gateway. Strips the optional `google/`
 * routing prefix, then matches gemini ids that carry an `image` segment.
 * Mirrors `isGoogleImageModel` in aihubmixImageModel.ts, narrowed to gemini
 * only — `imagen-*` is a real image model the gateway exposes natively.
 */
export function isGatewayGeminiImageModel(modelId: string): boolean {
  const normalized = modelId.replace(/^google\//i, '').toLowerCase()
  return normalized.startsWith('gemini-') && normalized.includes('image')
}

/**
 * Wrap a gateway `LanguageModelV3` as an `ImageModelV3` that drives image
 * generation through the language API with `responseModalities: ['IMAGE']`.
 */
export function createGatewayGeminiImageModel(languageModel: LanguageModelV3, modelId: string): ImageModelV3 {
  return {
    specificationVersion: 'v3',
    provider: GATEWAY_GOOGLE_IMAGE_PROVIDER,
    modelId,
    // Gemini returns a single image per generateContent call.
    maxImagesPerCall: 1,
    async doGenerate(options: ImageModelV3CallOptions) {
      const { prompt, n, size, aspectRatio, seed, files, providerOptions, headers, abortSignal } = options
      const warnings: Awaited<ReturnType<ImageModelV3['doGenerate']>>['warnings'] = []

      if (n != null && n > 1) {
        warnings.push({
          type: 'unsupported',
          feature: 'n',
          details: 'Gemini image models generate a single image per call. Extra images were not requested.'
        })
      }
      if (size != null) {
        warnings.push({
          type: 'unsupported',
          feature: 'size',
          details: 'This model does not support `size`. Use `aspectRatio` instead.'
        })
      }

      // Build the user turn: prompt text + any input images (editing support).
      const userContent: Array<
        { type: 'text'; text: string } | { type: 'file'; data: string | Uint8Array | URL; mediaType: string }
      > = []
      if (prompt != null) {
        userContent.push({ type: 'text', text: prompt })
      }
      if (files != null) {
        for (const file of files) {
          if (file.type === 'url') {
            userContent.push({ type: 'file', data: new URL(file.url), mediaType: 'image/*' })
          } else {
            userContent.push({
              type: 'file',
              data: typeof file.data === 'string' ? file.data : new Uint8Array(file.data),
              mediaType: file.mediaType
            })
          }
        }
      }

      const existingGoogle = (providerOptions?.google ?? {}) as Record<string, JSONValue>
      const google: Record<string, JSONValue> = {
        ...existingGoogle,
        responseModalities: ['IMAGE'],
        ...(aspectRatio ? { imageConfig: { aspectRatio } } : {})
      }

      const result = await languageModel.doGenerate({
        prompt: [{ role: 'user', content: userContent }],
        ...(seed != null ? { seed } : {}),
        ...(headers ? { headers } : {}),
        ...(abortSignal ? { abortSignal } : {}),
        providerOptions: { google }
      })

      const images: string[] = []
      for (const part of result.content) {
        if (part.type === 'file' && part.mediaType.startsWith('image/')) {
          images.push(convertToBase64(part.data))
        }
      }

      return {
        images,
        warnings,
        response: {
          timestamp: new Date(),
          modelId,
          headers: result.response?.headers ?? {}
        }
      }
    }
  }
}
