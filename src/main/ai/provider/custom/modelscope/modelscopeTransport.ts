import { DEFAULT_TIMEOUT } from '@main/ai/constants'
import { parseDataUrl } from '@shared/utils'

import type { ImageGenerationSubmitInput, ImageGenerationTransport } from '../imageGenerationModel'
import { createAbortError, isTerminalHttpStatus, uint8ToBase64, waitWithSignal } from '../transportUtils'

/**
 * ModelScope (魔搭) API Inference transport for AIGC image generation.
 *
 * Submit POST `/v1/images/generations` with `X-ModelScope-Async-Mode: true` →
 * returns `{ task_id }`. Poll `GET /v1/tasks/{task_id}` with
 * `X-ModelScope-Task-Type: image_generation` until `task_status === 'SUCCEED'`,
 * then read `output_images[]` (raw URL strings). Free-tier limits apply per
 * ModelScope's fair-use quotas.
 *
 * Wire-format notes (per api-inference docs):
 *   - `size` is the WxH string itself (e.g. `'1024x1024'`), NOT a width /
 *     height split.
 *   - Sampling fields are `steps` and `guidance` (NOT `num_inference_steps`
 *     / `guidance_scale`). `buildImageProviderOptions`'s default branch
 *     snake-cases the painting form's `numInferenceSteps` / `guidanceScale`
 *     into `num_inference_steps` / `guidance_scale`, which this transport
 *     accepts and renames to ModelScope's spelling.
 *   - `negative_prompt` and `seed` are forwarded as-is.
 *   - `image_url` carries the edit-mode input image (Qwen-Image-Edit-*).
 */

export const DEFAULT_MODELSCOPE_BASE_URL = 'https://api-inference.modelscope.cn'

export class ModelscopeApiError extends Error {
  constructor(
    message: string,
    public statusCode: number
  ) {
    super(message)
    this.name = 'ModelscopeApiError'
  }
}

export class ModelscopeTaskFailedError extends Error {
  constructor(reason: string) {
    super(reason)
    this.name = 'ModelscopeTaskFailedError'
  }
}

export type ModelscopeTaskStatus = 'PENDING' | 'RUNNING' | 'SUCCEED' | 'FAILED'

export interface ModelscopeTaskResult {
  task_id?: string
  task_status: ModelscopeTaskStatus
  output_images?: string[]
  message?: string
}

/**
 * Vendor-specific fields forwarded through `providerOptions.modelscope`.
 * AI SDK native fields (size / n / seed / prompt) source from `input.*`.
 */
export interface ModelscopeProviderParams {
  model?: string
  numInferenceSteps?: number
  num_inference_steps?: number
  guidanceScale?: number
  guidance_scale?: number
  negativePrompt?: string
  negative_prompt?: string
  seed?: number
}

export interface ModelscopeTransportSettings {
  apiKey: string
  baseURL?: string
}

function readNumber(bag: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = bag[key]
    if (typeof value === 'number') return value
    if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value)) return Number(value)
  }
  return undefined
}

function readString(bag: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = bag[key]
    if (typeof value === 'string' && value !== '') return value
  }
  return undefined
}

class ModelscopeTransport implements ImageGenerationTransport {
  private apiKey: string
  private baseURL: string

  constructor(settings: ModelscopeTransportSettings) {
    this.apiKey = settings.apiKey
    this.baseURL = settings.baseURL || DEFAULT_MODELSCOPE_BASE_URL
  }

  async submit(input: ImageGenerationSubmitInput): Promise<{ taskId?: string; imageUrls?: string[] }> {
    const bag = input.providerParams ?? {}

    const body: Record<string, unknown> = {
      model: input.modelId,
      prompt: input.prompt ?? ''
    }

    // ModelScope's `size` is the WxH string itself — NOT split into
    // width / height (api-inference docs).
    if (input.size) body.size = input.size

    // Image-edit models (Qwen-Image-Edit-*) require `image_url`. AI SDK
    // normalizes attached input images into `input.files` (post `prompt: { text,
    // images }`). Pass the first one — ModelScope accepts http(s) or data URLs.
    const firstFile = input.files?.[0]
    if (firstFile) {
      if (firstFile.type === 'url') {
        body.image_url = firstFile.url
      } else if (typeof firstFile.data === 'string') {
        const parsed = parseDataUrl(firstFile.data)
        body.image_url = parsed ? firstFile.data : `data:${firstFile.mediaType || 'image/png'};base64,${firstFile.data}`
      } else {
        body.image_url = `data:${firstFile.mediaType || 'image/png'};base64,${uint8ToBase64(firstFile.data)}`
      }
    }

    // ModelScope uses `steps` / `guidance`, not `num_inference_steps` /
    // `guidance_scale`. The bag arrives snake-cased from
    // `buildImageProviderOptions`'s default branch; accept both forms.
    const steps = readNumber(bag, 'numInferenceSteps', 'num_inference_steps', 'steps')
    if (steps !== undefined) body.steps = steps

    const guidance = readNumber(bag, 'guidanceScale', 'guidance_scale', 'guidance')
    if (guidance !== undefined) body.guidance = guidance

    const negativePrompt = readString(bag, 'negativePrompt', 'negative_prompt')
    if (negativePrompt) body.negative_prompt = negativePrompt

    const seed = readNumber(bag, 'seed') ?? input.seed
    if (seed !== undefined) body.seed = seed

    const response = await this.request<{ task_id: string }>(`/v1/images/generations`, 'POST', body, {
      timeout: 120000,
      signal: input.signal,
      extraHeaders: { 'X-ModelScope-Async-Mode': 'true' }
    })

    return { taskId: response.task_id }
  }

  async poll(
    taskId: string,
    options: { signal?: AbortSignal; onProgress?: (progress: number) => void }
  ): Promise<string[]> {
    const result = await this.pollTaskResult(taskId, options)
    return result.output_images ?? []
  }

  private async pollTaskResult(
    taskId: string,
    options?: {
      interval?: number
      maxAttempts?: number
      onProgress?: (progress: number) => void
      signal?: AbortSignal
    }
  ): Promise<ModelscopeTaskResult> {
    const { interval, maxAttempts = 120, signal } = options || {}
    const maxTransientRetries = 10
    let attempts = 0
    let transientRetries = 0
    const startTime = Date.now()

    while (attempts < maxAttempts) {
      if (signal?.aborted) {
        throw createAbortError('Task polling aborted')
      }

      try {
        const result = await this.request<ModelscopeTaskResult>(
          `/v1/tasks/${encodeURIComponent(taskId)}`,
          'GET',
          undefined,
          {
            timeout: 10000,
            signal,
            extraHeaders: { 'X-ModelScope-Task-Type': 'image_generation' }
          }
        )
        transientRetries = 0

        if (result.task_status === 'SUCCEED') return result
        if (result.task_status === 'FAILED') {
          throw new ModelscopeTaskFailedError(result.message || 'Task failed')
        }
      } catch (error) {
        if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
          throw createAbortError('Task polling aborted')
        }
        // Terminal failure or a 4xx (bar 429) poll response ends the loop;
        // 5xx / 429 fall through to transient retry.
        if (error instanceof ModelscopeTaskFailedError) {
          throw error
        }
        if (error instanceof ModelscopeApiError && isTerminalHttpStatus(error.statusCode)) {
          throw error
        }

        transientRetries++
        if (transientRetries >= maxTransientRetries) {
          throw error instanceof Error ? error : new Error(String(error))
        }
        const elapsedTime = Date.now() - startTime
        const pollDelay = interval ?? (elapsedTime < 60000 ? 3000 : 10000)
        await waitWithSignal(pollDelay, signal)
        continue
      }

      const elapsedTime = Date.now() - startTime
      const pollDelay = interval ?? (elapsedTime < 60000 ? 3000 : 10000)
      await waitWithSignal(pollDelay, signal)
      attempts++
    }

    throw new Error('Task polling timeout')
  }

  private async request<T>(
    path: string,
    method: 'POST' | 'GET',
    body: Record<string, unknown> | undefined,
    options: { timeout?: number; signal?: AbortSignal; extraHeaders?: Record<string, string> }
  ): Promise<T> {
    const timeout = options.timeout ?? DEFAULT_TIMEOUT
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

    const fetchOptions: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        ...(method === 'POST' && { 'Content-Type': 'application/json' }),
        ...options.extraHeaders
      },
      signal: controller.signal
    }
    if (method === 'POST' && body !== undefined) {
      fetchOptions.body = JSON.stringify(body)
    }

    try {
      const response = await fetch(`${this.baseURL}${path}`, fetchOptions)
      if (!response.ok) {
        const errorText = (await response.text().catch(() => '')).slice(0, 500)
        throw new ModelscopeApiError(`ModelScope API error: ${response.status} - ${errorText}`, response.status)
      }
      return (await response.json()) as T
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        if (externallyAborted) throw createAbortError('ModelScope API request aborted')
        throw new Error(`ModelScope API request timeout after ${timeout / 1000}s`)
      }
      throw error
    } finally {
      clearTimeout(timeoutId)
      externalSignal?.removeEventListener('abort', onExternalAbort)
    }
  }
}

export function createModelscopeTransport(settings: ModelscopeTransportSettings): ModelscopeTransport {
  return new ModelscopeTransport(settings)
}

export type { ModelscopeTransport }
