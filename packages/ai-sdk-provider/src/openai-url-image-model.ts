import { APICallError, type ImageModelV3, type ImageModelV3File, type SharedV3Warning } from '@ai-sdk/provider'
import {
  combineHeaders,
  convertBase64ToUint8Array,
  convertToFormData,
  downloadBlob,
  extractResponseHeaders,
  type FetchFunction,
  removeUndefinedEntries
} from '@ai-sdk/provider-utils'

export interface OpenAIUrlImageModelConfig {
  provider: string
  headers: () => Record<string, string | undefined>
  url: (options: { modelId: string; path: string }) => string
  fetch?: FetchFunction
  providerOptionsKey?: string
  _internal?: {
    currentDate?: () => Date
  }
}

type ImageResponseItem = {
  b64_json?: string
  url?: string
}

type ImageResponseBody = {
  data?: ImageResponseItem[]
  images?: ImageResponseItem[]
}

export class OpenAIUrlImageModel implements ImageModelV3 {
  readonly specificationVersion = 'v3'
  readonly maxImagesPerCall = 10

  get provider(): string {
    return this.config.provider
  }

  private get providerOptionsKey(): string {
    return this.config.providerOptionsKey ?? this.config.provider.split('.')[0].trim()
  }

  constructor(
    readonly modelId: string,
    private readonly config: OpenAIUrlImageModelConfig
  ) {}

  private getArgs(providerOptions: NonNullable<Parameters<ImageModelV3['doGenerate']>[0]['providerOptions']>) {
    return {
      ...providerOptions[this.providerOptionsKey],
      ...providerOptions[toCamelCase(this.providerOptionsKey)]
    }
  }

  async doGenerate({
    prompt,
    n,
    size,
    aspectRatio,
    seed,
    providerOptions,
    headers,
    abortSignal,
    files,
    mask
  }: Parameters<ImageModelV3['doGenerate']>[0]): Promise<Awaited<ReturnType<ImageModelV3['doGenerate']>>> {
    const warnings: SharedV3Warning[] = []

    if (aspectRatio != null) {
      warnings.push({
        type: 'unsupported',
        feature: 'aspectRatio',
        details: 'This model does not support aspect ratio. Use `size` instead.'
      })
    }

    if (seed != null) {
      warnings.push({ type: 'unsupported', feature: 'seed' })
    }

    const currentDate = this.config._internal?.currentDate?.() ?? new Date()
    const args = this.getArgs(providerOptions ?? {})
    const response =
      files != null && files.length > 0
        ? await this.postFormData({
            path: '/images/edits',
            headers,
            abortSignal,
            formData: convertToFormData({
              model: this.modelId,
              prompt,
              image: await Promise.all(files.map(fileToBlob)),
              mask: mask != null ? await fileToBlob(mask) : undefined,
              n,
              size,
              ...args
            })
          })
        : await this.postJson({
            path: '/images/generations',
            headers,
            abortSignal,
            body: {
              model: this.modelId,
              prompt,
              n,
              size,
              ...args
            }
          })

    return {
      images: extractImageOutputs(response.value),
      warnings,
      response: {
        timestamp: currentDate,
        modelId: this.modelId,
        headers: response.responseHeaders
      }
    }
  }

  private async postJson(options: {
    path: string
    headers?: Record<string, string | undefined>
    abortSignal?: AbortSignal
    body: Record<string, unknown>
  }) {
    return this.post({
      path: options.path,
      headers: { 'Content-Type': 'application/json', ...options.headers },
      body: JSON.stringify(options.body),
      requestBodyValues: options.body,
      abortSignal: options.abortSignal
    })
  }

  private async postFormData(options: {
    path: string
    headers?: Record<string, string | undefined>
    abortSignal?: AbortSignal
    formData: FormData
  }) {
    return this.post({
      path: options.path,
      headers: options.headers,
      body: options.formData,
      requestBodyValues: Object.fromEntries((options.formData as any).entries()),
      abortSignal: options.abortSignal
    })
  }

  private async post(options: {
    path: string
    headers?: Record<string, string | undefined>
    body: string | FormData
    requestBodyValues: unknown
    abortSignal?: AbortSignal
  }): Promise<{ value: ImageResponseBody; responseHeaders: Record<string, string> }> {
    const url = this.config.url({ path: options.path, modelId: this.modelId })
    const fetch = this.config.fetch ?? globalThis.fetch
    const response = await fetch(url, {
      method: 'POST',
      headers: removeUndefinedEntries(combineHeaders(this.config.headers(), options.headers)),
      body: options.body,
      signal: options.abortSignal
    })
    const responseHeaders = extractResponseHeaders(response)
    const responseBody = await response.text()

    if (!response.ok) {
      throw new APICallError({
        message: responseBody || response.statusText,
        url,
        requestBodyValues: options.requestBodyValues,
        statusCode: response.status,
        responseHeaders,
        responseBody
      })
    }

    let value: ImageResponseBody
    try {
      value = JSON.parse(responseBody) as ImageResponseBody
    } catch (cause) {
      throw new APICallError({
        message: 'Invalid JSON response',
        cause,
        url,
        requestBodyValues: options.requestBodyValues,
        statusCode: response.status,
        responseHeaders,
        responseBody
      })
    }

    return { value, responseHeaders }
  }
}

export function extractImageOutputs(body: ImageResponseBody): string[] {
  const fromData = extractItems(body.data)
  if (fromData.length > 0) return fromData
  return extractItems(body.images)
}

function extractItems(items: ImageResponseItem[] | undefined): string[] {
  if (!Array.isArray(items)) return []
  return items.flatMap((item) => {
    if (typeof item.b64_json === 'string') return [item.b64_json]
    if (typeof item.url === 'string') return [item.url]
    return []
  })
}

async function fileToBlob(file: ImageModelV3File): Promise<Blob> {
  if (file.type === 'url') {
    return downloadBlob(file.url)
  }

  const data = file.data instanceof Uint8Array ? file.data : convertBase64ToUint8Array(file.data)
  return new Blob([data as BlobPart], { type: file.mediaType })
}

function toCamelCase(str: string): string {
  return str.replace(/[_-]([a-z])/g, (match) => match[1].toUpperCase())
}
