import type { ImageModelV3, ImageModelV3CallOptions, SharedV3Warning } from '@ai-sdk/provider'
import type { FetchFunction } from '@ai-sdk/provider-utils'

import { parseImageVendorParams } from '@main/ai/utils/imageOptions'

import { executeImageTransport } from '../imageTransportRuntime'
import { createSiliconTransport, siliconImageLimits } from './siliconTransport'

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

export class SiliconImageModel implements ImageModelV3 {
  readonly specificationVersion = 'v3'
  get maxImagesPerCall(): number {
    return siliconImageLimits(this.modelId).outputs
  }

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

    const providerParams = parseImageVendorParams(providerOptions.silicon ?? {})
    const transport = createSiliconTransport(this.config)
    const images = await executeImageTransport({
      transport,
      input: {
        modelId: this.modelId,
        prompt,
        n,
        size,
        aspectRatio,
        seed,
        files,
        mask,
        providerParams,
        headers,
        signal: abortSignal
      },
      onTaskSubmitted: async () => {},
      onProgress: () => {},
      logContext: { provider: this.provider, modelId: this.modelId }
    })

    return {
      images,
      warnings,
      response: {
        timestamp: this.config._internal?.currentDate?.() ?? new Date(),
        modelId: this.modelId,
        headers: {}
      }
    }
  }
}

export function createSiliconImageModel(modelId: string, config: SiliconImageModelConfig): SiliconImageModel {
  return new SiliconImageModel(modelId, config)
}
