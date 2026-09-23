import type { ImageModelV3File } from '@ai-sdk/provider'

import type { ImageGenerationTransport } from '../imageGenerationModel'

interface ArkImageSettings {
  baseURL?: string
  apiKey?: string
  headers?: Record<string, string>
  fetch?: typeof fetch
}

function imageUrl(file: ImageModelV3File): string {
  if (file.type === 'url') return file.url.toString()
  const bytes = typeof file.data === 'string' ? file.data : Buffer.from(file.data).toString('base64')
  return `data:${file.mediaType};base64,${bytes}`
}

/** Ark uses the same JSON endpoint for text generation and reference-image editing. */
export function buildArkImageTransport(settings: ArkImageSettings): ImageGenerationTransport {
  return {
    async submit(input) {
      if (input.mask) throw new Error('Ark Seedream does not accept a mask')
      const params = input.providerParams
      const body: Record<string, unknown> = {
        model: input.modelId,
        prompt: input.prompt ?? '',
        response_format: 'url',
        stream: false,
        size: input.size ?? params.imageResolution ?? '2K'
      }
      if (input.files?.length) body.image = input.files.map(imageUrl)
      if (input.seed !== undefined) body.seed = input.seed
      if (params.addWatermark !== undefined) body.watermark = params.addWatermark
      if (params.outputFormat !== undefined) body.output_format = params.outputFormat
      const sequential = params.sequentialImageGeneration ?? (input.n > 1 ? 'auto' : 'disabled')
      body.sequential_image_generation = sequential
      if (sequential === 'auto') body.sequential_image_generation_options = { max_images: params.maxImages ?? input.n }
      const response = await (settings.fetch ?? fetch)(
        `${(settings.baseURL ?? 'https://ark.cn-beijing.volces.com/api/v3').replace(/\/+$/, '')}/images/generations`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${settings.apiKey ?? ''}`,
            ...settings.headers
          },
          body: JSON.stringify(body),
          signal: input.signal
        }
      )
      if (!response.ok) {
        const errorBody = await response.json().catch(() => null)
        const message = errorBody?.error?.message ?? errorBody?.message
        const detail = typeof message === 'string' ? message.trim().slice(0, 1000) : ''
        throw new Error(`Ark image request failed (HTTP ${response.status})${detail ? `: ${detail}` : ''}`)
      }
      const result = (await response.json()) as {
        data?: { url?: string; b64_json?: string }[]
        error?: { message?: string }
      }
      if (result.error) throw new Error(result.error.message ?? 'Ark image generation failed')
      const imageUrls = (result.data ?? []).flatMap((image) =>
        image.url
          ? [image.url]
          : image.b64_json
            ? [`data:image/${params.outputFormat === 'png' ? 'png' : 'jpeg'};base64,${image.b64_json}`]
            : []
      )
      if (!imageUrls.length) throw new Error('Ark returned no images')
      return { imageUrls }
    }
  }
}
