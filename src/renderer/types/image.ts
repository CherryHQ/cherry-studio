export type { GenerateImageParams } from '@shared/types/image'

/**
 * Image edit parameters.
 * Used to generate an edited image from an input image plus a text prompt.
 */
export type EditImageParams = {
  /** Model id */
  model: string
  /** Edit prompt */
  prompt: string
  /** Input images to edit (Buffer, Uint8Array, or a base64/URL string) */
  inputImages: (Buffer | Uint8Array | string)[]
  /** Optional mask image for inpainting (marks the region to edit) */
  mask?: Buffer | Uint8Array | string
  /** Output image size */
  imageSize?: string
  /** OpenAI image-body quality (e.g. 'high'/'auto'); forwarded via providerOptions */
  quality?: string
  /** OpenAI image-body field (e.g. 'transparent'/'opaque'/'auto') */
  background?: string
  /** OpenAI image-body field (e.g. 'low'/'auto') */
  moderation?: string
  /**
   * Extra AI SDK `providerOptions` merged into the built map, keyed by the
   * resolved provider id. See {@link GenerateImageParams.providerOptions}.
   */
  providerOptions?: Record<string, Record<string, unknown>>
  /** Abort signal */
  signal?: AbortSignal
}

export type GenerateImageResponse = {
  type: 'url' | 'base64'
  images: string[]
}
