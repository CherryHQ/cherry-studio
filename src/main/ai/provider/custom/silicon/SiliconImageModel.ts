import { APICallError, type ImageModelV3, type ImageModelV3CallOptions, type SharedV3Warning } from '@ai-sdk/provider'
import { combineHeaders, type FetchFunction, removeUndefinedEntries } from '@ai-sdk/provider-utils'

import { fileToDataUrl } from '../transportUtils'

/**
 * SiliconFlow Image Generation model — one class for every SiliconFlow
 * image model (Kolors, Qwen-Image, Qwen-Image-Edit-*, Stable-Diffusion-XL,
 * FLUX-on-silicon, Z-Image, etc). They all POST to the same endpoint with
 * the same body shape; only the field set each model honors differs, and
 * the registry's `imageGeneration.supports` drives which fields the form
 * collects — extras are silently ignored by the vendor.
 * @see https://api-docs.siliconflow.cn/docs/api/images-generations-post
 */

export interface SiliconImageModelConfig {
  provider: string
  url: (options: { modelId: string; path: string }) => string
  headers: () => Record<string, string | undefined>
  fetch?: FetchFunction
  _internal?: {
    currentDate?: () => Date
  }
}

type ImageItem = { url?: string; b64_json?: string }
type ImageResponseBody = {
  images?: ImageItem[]
  data?: ImageItem[]
}

export class SiliconImageModel implements ImageModelV3 {
  readonly specificationVersion = 'v3'
  // Kolors caps batch at 4; Qwen-family is single-image. We leave the
  // AI SDK to fan out (callCount = ceil(n / 1)) past 1 — the body's
  // `batch_size` only honors the value it understands.
  readonly maxImagesPerCall = 4

  get provider(): string {
    return this.config.provider
  }

  constructor(
    readonly modelId: string,
    private readonly config: SiliconImageModelConfig
  ) {}

  async doGenerate(options: ImageModelV3CallOptions): Promise<Awaited<ReturnType<ImageModelV3['doGenerate']>>> {
    const { prompt, n, size, seed, aspectRatio, providerOptions, headers, abortSignal, files, mask } = options
    const warnings: SharedV3Warning[] = []

    if (aspectRatio != null) {
      warnings.push({
        type: 'unsupported',
        feature: 'aspectRatio',
        details: 'SiliconFlow uses `image_size` (WxH); aspectRatio is ignored.'
      })
    }
    if (mask != null) {
      warnings.push({ type: 'unsupported', feature: 'mask' })
    }

    // `silicon` matches `providerOptionsKey` derived from
    // `siliconProvider.ts` (`SILICON_PROVIDER_NAME = 'silicon'`).
    const bag = (providerOptions?.silicon ?? providerOptions?.openai ?? {}) as Record<string, unknown>
    const body: Record<string, unknown> = {
      model: this.modelId,
      prompt: prompt ?? ''
    }
    if (size) body.image_size = size
    if (typeof n === 'number' && n > 1) body.batch_size = n

    if (typeof seed === 'number') body.seed = seed
    else if (typeof bag.seed === 'number') body.seed = bag.seed
    else if (typeof bag.seed === 'string' && /^-?\d+$/.test(bag.seed.trim())) body.seed = Number(bag.seed.trim())

    for (const key of [
      'negative_prompt',
      'num_inference_steps',
      'guidance_scale',
      'cfg',
      'prompt_enhancement'
    ] as const) {
      const value = bag[key]
      if (value !== undefined && value !== '' && value !== null) body[key] = value
    }

    // Qwen-Image-Edit-2509 takes up to 3 input images as `image` / `image2` / `image3`.
    // For models that only accept `image`, sending the extras is harmless — the
    // vendor ignores unknown fields. We don't try to gate per-model here.
    if (files && files.length > 0) {
      const slots = ['image', 'image2', 'image3'] as const
      for (let i = 0; i < Math.min(files.length, slots.length); i++) {
        body[slots[i]] = fileToDataUrl(files[i])
      }
    }

    const url = this.config.url({ path: '/images/generations', modelId: this.modelId })
    const fetchFn = this.config.fetch ?? globalThis.fetch
    const response = await fetchFn(url, {
      method: 'POST',
      headers: removeUndefinedEntries(
        combineHeaders(this.config.headers(), headers, { 'Content-Type': 'application/json' })
      ),
      body: JSON.stringify(body),
      signal: abortSignal
    })

    const responseHeaders: Record<string, string> = {}
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value
    })
    const responseBody = await response.text()

    if (!response.ok) {
      throw new APICallError({
        message: responseBody || response.statusText,
        url,
        requestBodyValues: body,
        statusCode: response.status,
        responseHeaders,
        responseBody
      })
    }

    let parsed: ImageResponseBody
    try {
      parsed = JSON.parse(responseBody) as ImageResponseBody
    } catch (cause) {
      throw new APICallError({
        message: 'Invalid JSON response from SiliconFlow',
        cause,
        url,
        requestBodyValues: body,
        statusCode: response.status,
        responseHeaders,
        responseBody
      })
    }

    const items = parsed.images ?? parsed.data ?? []
    const images: string[] = items.flatMap((item) => {
      if (typeof item.b64_json === 'string') return [item.b64_json]
      if (typeof item.url === 'string') return [item.url]
      return []
    })

    return {
      images,
      warnings,
      response: {
        timestamp: this.config._internal?.currentDate?.() ?? new Date(),
        modelId: this.modelId,
        headers: responseHeaders
      }
    }
  }
}

export function createSiliconImageModel(modelId: string, config: SiliconImageModelConfig): SiliconImageModel {
  return new SiliconImageModel(modelId, config)
}
