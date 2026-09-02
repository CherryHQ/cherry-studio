import type { FetchFunction } from '@ai-sdk/provider-utils'
import { t } from '@main/i18n'
import { createPaintingGenerateError, PaintingGenerateError } from '@shared/ai/paintingGenerateError'

import type { ImageGenerationSubmitInput, ImageGenerationTransport } from '../imageGenerationModel'
import { readErrorMessage } from '../readErrorMessage'
import { createAbortError, fileToDataUrl, isTerminalHttpStatus, waitWithSignal } from '../transportUtils'

/**
 * Tencent TokenHub image transport (cloud.tencent.com/document/product/1823/130080).
 *
 * TokenHub's image models are NOT served on the OpenAI `/v1/images/*` wire; each
 * family has its own `/v1/wand/*` endpoint under the host root:
 *   - hunyuan (`hy-image-v3`): `/v1/wand/hunyuan-image/v3-generation`, sync, `data[].url`
 *   - seedream (`seedream-image-v5.0-*`): `/v1/wand/si-image/generation`, sync, `data[].url`
 *   - vidu (`vidu-image-q2`): `/v1/wand/vidu-image/generation`, async → poll
 *     `GET /v1/wand/vidu-image/tasks/{task_id}` until `state === 'success'`, `creations[].url`
 *
 * Routing comes from the registry's `modes[mode].vendorTransport` (endpoint + isSync) via
 * `input.modelDescriptor`; the body family is picked from the endpoint path, not a model-id table.
 */

export const DEFAULT_TOKENHUB_BASE_URL = 'https://tokenhub.tencentmaas.com'

const VIDU_TASKS_PATH = '/v1/wand/vidu-image/tasks'

export class TokenhubApiError extends Error {
  constructor(
    message: string,
    public statusCode: number
  ) {
    super(message)
    this.name = 'TokenhubApiError'
  }
}

export class TokenhubTaskFailedError extends Error {
  constructor(reason: string) {
    super(reason)
    this.name = 'TokenhubTaskFailedError'
  }
}

export type TokenhubTaskState = 'created' | 'queueing' | 'processing' | 'success' | 'failed'

interface TokenhubSyncImageResponse {
  data?: Array<{ url?: string; b64_json?: string }>
}

interface TokenhubViduSubmitResponse {
  task_id?: string
  state?: TokenhubTaskState
}

interface TokenhubViduTaskResponse {
  state?: TokenhubTaskState
  creations?: Array<{ url?: string }>
  message?: string
  err_msg?: string
}

/** Canonical camelCase params (the transport receives the vendorBag directly). */
export interface TokenhubProviderParams {
  /** hy-image-v3 `revise` (prompt rewriting). */
  promptEnhancement?: boolean
  /** seedream `size` tier (`1K` / `2K` / …) when no explicit `WxH` size is set. */
  imageResolution?: string
  outputFormat?: string
  addWatermark?: boolean
  sequentialImageGeneration?: 'auto' | 'disabled'
  maxImages?: number
  /** vidu `resolution` (`1080p` / `2K` / `4K`). */
  resolution?: string
}

export interface TokenhubTransportSettings {
  apiKey: string
  baseURL?: string
  headers?: Record<string, string>
  fetch?: FetchFunction
}

type BodyFamily = 'hunyuan' | 'seedream' | 'vidu'

function bodyFamilyFor(endpoint: string): BodyFamily {
  if (endpoint.includes('/hunyuan-image/')) return 'hunyuan'
  if (endpoint.includes('/si-image/')) return 'seedream'
  if (endpoint.includes('/vidu-image/')) return 'vidu'
  throw new Error(`Unsupported TokenHub image endpoint: ${endpoint}`)
}

function imagesOf(input: ImageGenerationSubmitInput): string[] | undefined {
  if (!input.files?.length) return undefined
  return input.files.map((file) => fileToDataUrl(file))
}

function buildHunyuanBody(input: ImageGenerationSubmitInput, bag: TokenhubProviderParams): Record<string, unknown> {
  const body: Record<string, unknown> = { model: input.modelId, prompt: input.prompt ?? '' }
  const images = imagesOf(input)
  if (images) body.images = images
  if (input.size) body.size = input.size
  if (typeof input.seed === 'number') body.seed = input.seed
  if (bag.promptEnhancement !== undefined) body.revise = bag.promptEnhancement
  return body
}

function buildSeedreamBody(input: ImageGenerationSubmitInput, bag: TokenhubProviderParams): Record<string, unknown> {
  const body: Record<string, unknown> = { model: input.modelId, prompt: input.prompt ?? '', response_format: 'url' }
  const images = imagesOf(input)
  if (images) body.images = images
  const size = input.size ?? bag.imageResolution
  if (size) body.size = size
  if (bag.outputFormat) body.output_format = bag.outputFormat
  if (bag.addWatermark !== undefined) body.watermark = bag.addWatermark
  if (bag.sequentialImageGeneration) {
    body.sequential_image_generation = bag.sequentialImageGeneration
    if (bag.sequentialImageGeneration === 'auto' && typeof bag.maxImages === 'number') {
      body.sequential_image_generation_options = { max_images: bag.maxImages }
    }
  }
  return body
}

function buildViduBody(input: ImageGenerationSubmitInput, bag: TokenhubProviderParams): Record<string, unknown> {
  const body: Record<string, unknown> = { model: input.modelId, prompt: input.prompt ?? '' }
  const images = imagesOf(input)
  if (images) body.images = images
  if (input.aspectRatio) body.aspect_ratio = input.aspectRatio
  if (bag.resolution) body.resolution = bag.resolution
  if (typeof input.seed === 'number') body.seed = input.seed
  return body
}

function extractSyncUrls(response: TokenhubSyncImageResponse): string[] {
  return (response.data ?? [])
    .map((item) => item.url ?? (item.b64_json ? `data:image/png;base64,${item.b64_json}` : ''))
    .filter((url) => url.length > 0)
}

class TokenhubTransport implements ImageGenerationTransport {
  private apiKey: string
  private baseURL: string
  private headers: Record<string, string>
  private customFetch?: FetchFunction

  constructor(settings: TokenhubTransportSettings) {
    this.apiKey = settings.apiKey
    this.baseURL = settings.baseURL || DEFAULT_TOKENHUB_BASE_URL
    this.headers = settings.headers ?? {}
    this.customFetch = settings.fetch
  }

  async submit(input: ImageGenerationSubmitInput): Promise<{ taskId?: string; imageUrls?: string[] }> {
    const descriptor = input.modelDescriptor
    if (!descriptor) {
      throw new Error(`Missing modelDescriptor for TokenHub image model: ${input.modelId}`)
    }

    const bag = (input.providerParams ?? {}) as TokenhubProviderParams
    switch (bodyFamilyFor(descriptor.endpoint)) {
      case 'hunyuan': {
        const data = await this.request<TokenhubSyncImageResponse>(
          descriptor.endpoint,
          'POST',
          buildHunyuanBody(input, bag),
          {
            signal: input.signal
          }
        )
        return { imageUrls: extractSyncUrls(data) }
      }
      case 'seedream': {
        const data = await this.request<TokenhubSyncImageResponse>(
          descriptor.endpoint,
          'POST',
          buildSeedreamBody(input, bag),
          {
            signal: input.signal
          }
        )
        return { imageUrls: extractSyncUrls(data) }
      }
      case 'vidu': {
        const data = await this.request<TokenhubViduSubmitResponse>(
          descriptor.endpoint,
          'POST',
          buildViduBody(input, bag),
          {
            signal: input.signal
          }
        )
        if (!data.task_id) throw new TokenhubApiError('TokenHub async submit returned no task_id', 0)
        return { taskId: data.task_id }
      }
    }
  }

  async poll(
    taskId: string,
    options: { signal?: AbortSignal; onProgress?: (progress: number) => void }
  ): Promise<string[]> {
    const result = await this.pollTaskResult(taskId, options)
    return (result.creations ?? [])
      .map((entry) => entry.url)
      .filter((url): url is string => typeof url === 'string' && url.length > 0)
  }

  async pollTaskResult(
    taskId: string,
    options: { interval?: number; maxAttempts?: number; signal?: AbortSignal } = {}
  ): Promise<TokenhubViduTaskResponse> {
    const { interval, maxAttempts = 120, signal } = options
    const maxTransientRetries = 10
    let attempts = 0
    let transientRetries = 0
    const startTime = Date.now()

    while (attempts < maxAttempts) {
      if (signal?.aborted) throw createAbortError('Task polling aborted')

      try {
        const result = await this.request<TokenhubViduTaskResponse>(
          `${VIDU_TASKS_PATH}/${encodeURIComponent(taskId)}`,
          'GET',
          undefined,
          { timeout: 10000, signal }
        )
        transientRetries = 0
        if (result.state === 'success') return result
        if (result.state === 'failed') {
          throw new TokenhubTaskFailedError(result.err_msg || result.message || 'TokenHub task failed')
        }
      } catch (error) {
        if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
          throw createAbortError('Task polling aborted')
        }
        // `request` already converted terminal 4xx into PaintingGenerateError; a
        // TokenhubApiError is therefore always 5xx / 429 → transient.
        if (error instanceof TokenhubTaskFailedError || error instanceof PaintingGenerateError) throw error

        transientRetries++
        if (transientRetries >= maxTransientRetries) {
          throw error instanceof Error ? error : new Error(String(error))
        }
        await waitWithSignal(interval ?? this.pollDelay(startTime), signal)
        continue
      }

      await waitWithSignal(interval ?? this.pollDelay(startTime), signal)
      attempts++
    }

    throw new Error('Task polling timeout')
  }

  private pollDelay(startTime: number): number {
    return Date.now() - startTime < 60000 ? 3000 : 10000
  }

  private async request<T>(
    path: string,
    method: 'POST' | 'GET',
    body: Record<string, unknown> | undefined,
    options: { timeout?: number; signal?: AbortSignal }
  ): Promise<T> {
    const timeout = options.timeout ?? 120000
    const externalSignal = options.signal
    const controller = new AbortController()
    let externallyAborted = false

    const timeoutId = setTimeout(() => controller.abort(), timeout)
    const onExternalAbort = () => {
      externallyAborted = true
      controller.abort()
    }
    if (externalSignal?.aborted) {
      externallyAborted = true
      controller.abort()
    } else {
      externalSignal?.addEventListener('abort', onExternalAbort, { once: true })
    }

    try {
      const doFetch = this.customFetch ?? globalThis.fetch
      const response = await doFetch(`${this.baseURL}${path}`, {
        method,
        headers: {
          Accept: 'application/json',
          ...this.headers,
          Authorization: `Bearer ${this.apiKey}`,
          ...(method === 'POST' && { 'Content-Type': 'application/json' })
        },
        ...(method === 'POST' && body !== undefined && { body: JSON.stringify(body) }),
        signal: controller.signal
      })
      if (!response.ok) {
        if (response.status === 401) throw createPaintingGenerateError('REQ_ERROR_TOKEN')
        if (isTerminalHttpStatus(response.status)) {
          const message = await readErrorMessage(response, t('paintings.generate_failed'))
          throw createPaintingGenerateError('REMOTE_ERROR', { message })
        }
        const errorText = (await response.text().catch(() => '')).slice(0, 500)
        throw new TokenhubApiError(`TokenHub API error: ${response.status} - ${errorText}`, response.status)
      }
      return (await response.json()) as T
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        if (externallyAborted) throw createAbortError('TokenHub API request aborted')
        throw new Error(`TokenHub API request timeout after ${timeout / 1000}s`)
      }
      throw error
    } finally {
      clearTimeout(timeoutId)
      externalSignal?.removeEventListener('abort', onExternalAbort)
    }
  }
}

export function createTokenhubTransport(settings: TokenhubTransportSettings): TokenhubTransport {
  return new TokenhubTransport(settings)
}

export type { TokenhubTransport }
