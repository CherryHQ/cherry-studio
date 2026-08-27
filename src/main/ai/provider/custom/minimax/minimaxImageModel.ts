import { APICallError, type ImageModelV3, type ImageModelV3CallOptions } from '@ai-sdk/provider'
import { type FetchFunction } from '@ai-sdk/provider-utils'
import { mergeHeaders } from '@main/utils/http'

import { fileToDataUrl } from '../transportUtils'

export interface MinimaxImageModelConfig {
  provider: string
  url: (options: { modelId: string; path: string }) => string
  headers: () => Record<string, string | undefined>
  fetch?: FetchFunction
  _internal?: {
    currentDate?: () => Date
  }
}

interface MinimaxImageResponse {
  data?: {
    image_urls?: string[]
    image_base64?: string[]
  }
  base_resp?: {
    status_code?: number
    status_msg?: string
  }
}

function responseHeaders(response: Response): Record<string, string> {
  const headers: Record<string, string> = {}
  response.headers.forEach((value, key) => {
    headers[key] = value
  })
  return headers
}

function parseSize(size: `${number}x${number}` | undefined): { width?: number; height?: number } {
  const match = size?.match(/^(\d+)x(\d+)$/)
  return match ? { width: Number(match[1]), height: Number(match[2]) } : {}
}

export class MinimaxImageModel implements ImageModelV3 {
  readonly specificationVersion = 'v3'
  readonly maxImagesPerCall = 9

  get provider(): string {
    return this.config.provider
  }

  constructor(
    readonly modelId: string,
    private readonly config: MinimaxImageModelConfig
  ) {}

  async doGenerate(options: ImageModelV3CallOptions): Promise<Awaited<ReturnType<ImageModelV3['doGenerate']>>> {
    const { prompt, n, size, seed, aspectRatio, files, providerOptions, headers, abortSignal } = options
    const bag = (providerOptions?.minimax ?? {}) as Record<string, unknown>
    const body: Record<string, unknown> = {
      model: this.modelId,
      prompt: prompt ?? '',
      n,
      ...parseSize(size)
    }

    if (aspectRatio) body.aspect_ratio = aspectRatio
    if (typeof seed === 'number') body.seed = seed
    if (files?.length) {
      body.subject_reference = files.map((file) => ({
        type: 'character',
        image_file: fileToDataUrl(file)
      }))
    }

    for (const key of ['aigc_watermark', 'prompt_optimizer', 'response_format'] as const) {
      const value = bag[key]
      if (value !== undefined && value !== '' && value !== null) body[key] = value
    }

    const url = this.config.url({ path: '/image_generation', modelId: this.modelId })
    const fetchFn = this.config.fetch ?? globalThis.fetch
    const response = await fetchFn(url, {
      method: 'POST',
      headers: mergeHeaders(this.config.headers(), headers, { 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
      signal: abortSignal
    })
    const headersRecord = responseHeaders(response)
    const responseBody = await response.text()

    if (!response.ok) {
      throw new APICallError({
        message: responseBody || response.statusText,
        url,
        requestBodyValues: body,
        statusCode: response.status,
        responseHeaders: headersRecord,
        responseBody
      })
    }

    let parsed: MinimaxImageResponse
    try {
      parsed = JSON.parse(responseBody) as MinimaxImageResponse
    } catch (cause) {
      throw new APICallError({
        message: 'Invalid JSON response from MiniMax',
        cause,
        url,
        requestBodyValues: body,
        statusCode: response.status,
        responseHeaders: headersRecord,
        responseBody
      })
    }

    if (parsed.base_resp?.status_code && parsed.base_resp.status_code !== 0) {
      throw new APICallError({
        message: parsed.base_resp.status_msg || `MiniMax error ${parsed.base_resp.status_code}`,
        url,
        requestBodyValues: body,
        statusCode: response.status,
        responseHeaders: headersRecord,
        responseBody
      })
    }

    return {
      images: [...(parsed.data?.image_urls ?? []), ...(parsed.data?.image_base64 ?? [])],
      warnings: [],
      response: {
        timestamp: this.config._internal?.currentDate?.() ?? new Date(),
        modelId: this.modelId,
        headers: headersRecord
      }
    }
  }
}
