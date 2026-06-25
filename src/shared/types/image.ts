import type { PersonGeneration } from '@google/genai'

export type GenerateImageParams = {
  model: string
  prompt: string
  /**
   * Input images for image-to-image / edit / remix / upscale flows. When
   * non-empty, painting callers ({@link AiProvider.generatePaintingImage})
   * forward these to AI SDK as `prompt: { text, images }` so the vendor
   * image-model picks the right edit endpoint.
   */
  inputImages?: (Buffer | Uint8Array | string)[]
  negativePrompt?: string
  imageSize?: string
  aspectRatio?: string
  /** Optional: painting callers may omit it; `AiProvider` falls back to `n: 1`. */
  batchSize?: number
  seed?: string
  numInferenceSteps?: number
  guidanceScale?: number
  signal?: AbortSignal
  promptEnhancement?: boolean
  personGeneration?: PersonGeneration
  quality?: string
  /** OpenAI image-body field (e.g. 'transparent'/'opaque'/'auto') */
  background?: string
  /** OpenAI image-body field (e.g. 'low'/'auto') */
  moderation?: string
  /** OpenAI image-body field — DALL-E 3 only ('vivid' / 'natural') */
  style?: string
  /**
   * Extra AI SDK `providerOptions` merged into the built map, keyed by the
   * resolved provider id. Carries provider-specific params (and non-JSON
   * callbacks like the polling `onProgress`) that the structured params can't
   * express. Passed by reference through the plugin chain.
   */
  providerOptions?: Record<string, Record<string, unknown>>
}
