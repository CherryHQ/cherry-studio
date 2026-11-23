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
import {
  type ImageModelV3,
  type ImageModelV3CallOptions,
  isJSONObject,
  type JSONObject,
  type LanguageModelV3
} from '@ai-sdk/provider'
import { convertToBase64 } from '@ai-sdk/provider-utils'

const GATEWAY_GOOGLE_IMAGE_PROVIDER = 'gateway.google.image' as const

/**
 * Gemini image models and Nano Banana aliases use the language API.
 * Imagen remains on Gateway's native image route.
 */
export function isGatewayGeminiImageModel(modelId: string): boolean {
  const normalized = modelId.replace(/^google\//i, '').toLowerCase()

  return (
    (normalized.startsWith('gemini-') && normalized.includes('image')) ||
    /^(?:gemini-)?nano-banana(?:-|$)/.test(normalized)
  )
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
      const { prompt, n, size, aspectRatio, seed, files, mask, providerOptions, headers, abortSignal } = options
      const warnings: Awaited<ReturnType<ImageModelV3['doGenerate']>>['warnings'] = []

      if (mask != null) {
        // Gemini edits via full-image prompts, not masks. Match @ai-sdk/google,
        // which rejects mask-based editing outright rather than ignoring it.
        throw new Error('Gemini image models do not support mask-based image editing.')
      }

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

      // Augment only the `google` namespace; keep every other caller option
      // (e.g. `gateway` routing: order/only/BYOK) intact, and deep-merge
      // imageConfig so an existing imageSize survives an added aspectRatio.
      const { gateway: rawGateway, ...otherProviderOptions } = providerOptions ?? {}
      const { imageResolution, ...gateway } = rawGateway ?? {}
      const existingGoogle = providerOptions?.google ?? {}

      const existingImageConfig =
        !Array.isArray(existingGoogle.imageConfig) && isJSONObject(existingGoogle.imageConfig)
          ? existingGoogle.imageConfig
          : {}

      const imageDefaults: JSONObject = {}

      if (typeof imageResolution === 'string' && imageResolution !== 'auto') imageDefaults.imageSize = imageResolution
      const imageConfig: JSONObject = { ...imageDefaults, ...existingImageConfig }

      if (aspectRatio) imageConfig.aspectRatio = aspectRatio

      const google: JSONObject = {
        ...existingGoogle,
        responseModalities: ['IMAGE']
      }

      if (Object.keys(imageConfig).length > 0) google.imageConfig = imageConfig

      const request: Parameters<LanguageModelV3['doGenerate']>[0] = {
        prompt: [{ role: 'user', content: userContent }]
      }

      if (seed != null) request.seed = seed

      if (headers) request.headers = headers

      if (abortSignal) request.abortSignal = abortSignal
      const requestProviderOptions = { ...otherProviderOptions }

      if (Object.keys(gateway).length > 0) requestProviderOptions.gateway = gateway
      request.providerOptions = { ...requestProviderOptions, google }
      const result = await languageModel.doGenerate(request)

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
