import type { PollingSubmitInput, PollingTransport } from '../pollingImageModel'

/**
 * PPIO submit/poll transport.
 *
 * Relocated verbatim from the legacy painting service
 * (`src/renderer/src/pages/paintings/providers/ppio/service.ts`):
 * same API host, adaptive 3s(<60s)/10s poll interval, `maxAttempts` 120,
 * `maxTransientRetries` 10, `TASK_STATUS_*` machine, per-model param builders
 * and the synchronous (`isSync`) path. Only the transport surface changed —
 * behavior and constants are identical.
 */

export const DEFAULT_PPIO_BASE_URL = 'https://api.ppio.com'

function createAbortError(message: string): Error {
  const error = new Error(message)
  error.name = 'AbortError'
  return error
}

function waitWithSignal(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(createAbortError('Task polling aborted'))
  }

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, delayMs)

    const onAbort = () => {
      clearTimeout(timeoutId)
      signal?.removeEventListener('abort', onAbort)
      reject(createAbortError('Task polling aborted'))
    }

    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export class PpioApiError extends Error {
  constructor(
    message: string,
    public statusCode: number
  ) {
    super(message)
    this.name = 'PpioApiError'
  }
}

export type PpioTaskStatus =
  | 'TASK_STATUS_QUEUED'
  | 'TASK_STATUS_PROCESSING'
  | 'TASK_STATUS_SUCCEED'
  | 'TASK_STATUS_FAILED'

export interface PpioTaskResult {
  task: {
    task_id: string
    status: PpioTaskStatus
    task_type: string
    reason?: string
    eta?: number
    progress_percent?: number
  }
  images?: Array<{
    image_url: string
    image_url_ttl: string
    image_type: string
  }>
  extra?: {
    seed?: string
    has_nsfw_contents?: boolean[]
  }
}

export interface PpioSyncResult {
  images?: string[]
}

/**
 * PPIO model descriptor needed by the transport: which endpoint to POST to
 * and whether the model responds synchronously with finished images.
 */
export interface PpioModelDescriptor {
  id: string
  endpoint: string
  isSync?: boolean
}

/**
 * Painting fields forwarded through `providerOptions['ppio']`. Mirrors the
 * `PpioPaintingData` subset the legacy `buildRequestParams` consumed.
 */
export interface PpioProviderParams {
  model?: string
  modelDescriptor?: PpioModelDescriptor
  size?: string
  ppioSeed?: number
  usePreLlm?: boolean
  addWatermark?: boolean
  imageFile?: string
  ppioMask?: string
  resolution?: string
  outputFormat?: string
  onProgress?: (progress: number) => void
  /** Painting telemetry: called once with the PPIO async task id (parity with
   * the bespoke `onGenerationStateChange({ generationTaskId })` callback). */
  onSubmitTaskId?: (taskId: string) => void
}

export interface PpioTransportSettings {
  apiKey: string
  baseURL?: string
}

class PpioTransport implements PollingTransport {
  private apiKey: string
  private baseURL: string

  constructor(settings: PpioTransportSettings) {
    this.apiKey = settings.apiKey
    this.baseURL = settings.baseURL || DEFAULT_PPIO_BASE_URL
  }

  private async request<T>(
    endpoint: string,
    body: Record<string, unknown>,
    method: 'POST' | 'GET' = 'POST',
    timeout: number = 120000,
    externalSignal?: AbortSignal
  ): Promise<T> {
    const url = `${this.baseURL}${endpoint}`
    const controller = new AbortController()
    let externallyAborted = false

    const timeoutId = setTimeout(() => {
      controller.abort()
    }, timeout)

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

    const options: RequestInit = {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`
      },
      signal: controller.signal
    }

    if (method === 'POST') {
      options.body = JSON.stringify(body)
    }

    try {
      const response = await fetch(url, options)

      if (!response.ok) {
        const errorText = (await response.text().catch(() => '')).slice(0, 500)
        throw new PpioApiError(`PPIO API error: ${response.status} - ${errorText}`, response.status)
      }

      const data = await response.json()
      return data as T
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        if (externallyAborted) {
          throw createAbortError('PPIO API request aborted')
        }

        throw new Error(`PPIO API request timeout after ${timeout / 1000}s`)
      }
      throw error
    } finally {
      clearTimeout(timeoutId)
      externalSignal?.removeEventListener('abort', onExternalAbort)
    }
  }

  async submit(input: PollingSubmitInput): Promise<{ taskId?: string; imageUrls?: string[] }> {
    const params = input.providerParams as PpioProviderParams
    const descriptor = params.modelDescriptor
    if (!descriptor) {
      throw new Error(`Unknown model: ${params.model}`)
    }

    const requestParams = this.buildRequestParams(input, params, descriptor.id)

    if (descriptor.isSync) {
      const result = await this.request<PpioSyncResult>(
        descriptor.endpoint,
        requestParams,
        'POST',
        120000,
        input.signal
      )
      return { imageUrls: result.images }
    }

    const result = await this.request<{ task_id: string }>(
      descriptor.endpoint,
      requestParams,
      'POST',
      120000,
      input.signal
    )
    // Surface the async task id so the painting layer can record/resume it
    // (parity with the bespoke `onGenerationStateChange({ generationTaskId })`).
    if (typeof params.onSubmitTaskId === 'function') {
      params.onSubmitTaskId(result.task_id)
    }
    return { taskId: result.task_id }
  }

  private buildRequestParams(
    input: PollingSubmitInput,
    painting: PpioProviderParams,
    modelId: string
  ): Record<string, unknown> {
    const params: Record<string, unknown> = {}

    if (input.prompt) {
      params.prompt = input.prompt
    }

    switch (modelId) {
      case 'jimeng-txt2img-v3.1':
      case 'jimeng-txt2img-v3.0':
        return this.buildJimengParams(input, painting)
      case 'hunyuan-image-3':
        return this.buildHunyuanParams(input, painting)
      case 'qwen-image-txt2img':
        return this.buildQwenTxt2ImgParams(input, painting)
      case 'qwen-image-edit':
        return this.buildQwenEditParams(input, painting)
      case 'z-image-turbo':
        return this.buildZImageParams(input, painting)
      case 'z-image-turbo-lora':
        return this.buildZImageLoraParams(input, painting)
      case 'seedream-4.5-draw':
      case 'seedream-4.0-draw':
        return this.buildSeedreamDrawParams(input, painting)
      case 'seedream-4.5-edit':
      case 'seedream-4.0-edit':
        return this.buildSeedreamEditParams(input, painting)
      case 'image-upscaler':
        return this.buildUpscalerParams(painting)
      case 'image-remove-background':
        return this.buildRemoveBackgroundParams(painting)
      case 'image-eraser':
        return this.buildEraserParams(input, painting)
      default:
        return params
    }
  }

  private buildJimengParams(input: PollingSubmitInput, painting: PpioProviderParams): Record<string, unknown> {
    const params: Record<string, unknown> = {
      prompt: input.prompt,
      use_pre_llm: painting.usePreLlm ?? true,
      seed: painting.ppioSeed ?? -1
    }

    if (painting.size) {
      const [width, height] = painting.size.split('x').map(Number)
      if (width && height) {
        params.width = width
        params.height = height
      }
    }

    if (painting.addWatermark) {
      params.logo_info = {
        add_logo: true
      }
    }

    return params
  }

  private buildHunyuanParams(input: PollingSubmitInput, painting: PpioProviderParams): Record<string, unknown> {
    return {
      prompt: input.prompt,
      size: painting.size?.replace('x', '*') || '1024*1024',
      seed: painting.ppioSeed ?? -1,
      watermark: painting.addWatermark ?? false
    }
  }

  private buildQwenTxt2ImgParams(input: PollingSubmitInput, painting: PpioProviderParams): Record<string, unknown> {
    return {
      prompt: input.prompt,
      size: painting.size?.replace('x', '*') || '1024*1024',
      watermark: painting.addWatermark ?? false
    }
  }

  private buildQwenEditParams(input: PollingSubmitInput, painting: PpioProviderParams): Record<string, unknown> {
    return {
      prompt: input.prompt,
      image: painting.imageFile,
      seed: painting.ppioSeed ?? -1,
      output_format: painting.outputFormat || 'jpeg',
      watermark: painting.addWatermark ?? false
    }
  }

  private buildZImageParams(input: PollingSubmitInput, painting: PpioProviderParams): Record<string, unknown> {
    return {
      prompt: input.prompt,
      size: painting.size?.replace('x', '*') || '1024*1024',
      seed: painting.ppioSeed ?? -1
    }
  }

  private buildZImageLoraParams(input: PollingSubmitInput, painting: PpioProviderParams): Record<string, unknown> {
    return {
      prompt: input.prompt,
      size: painting.size?.replace('x', '*') || '1024*1024',
      seed: painting.ppioSeed ?? -1,
      loras: []
    }
  }

  private buildSeedreamDrawParams(input: PollingSubmitInput, painting: PpioProviderParams): Record<string, unknown> {
    return {
      prompt: input.prompt,
      size: painting.size || '2048x2048',
      watermark: painting.addWatermark ?? true,
      sequential_image_generation: 'disabled'
    }
  }

  private buildSeedreamEditParams(input: PollingSubmitInput, painting: PpioProviderParams): Record<string, unknown> {
    const rawImage = painting.imageFile ?? ''
    const base64Image = rawImage.replace(/^data:[^;]+;base64,/, '')
    return {
      prompt: input.prompt,
      image: base64Image ? [base64Image] : [],
      size: painting.size || '2048x2048',
      watermark: painting.addWatermark ?? true,
      sequential_image_generation: 'disabled'
    }
  }

  private buildUpscalerParams(painting: PpioProviderParams): Record<string, unknown> {
    return {
      image: painting.imageFile,
      resolution: painting.resolution || '4k',
      output_format: painting.outputFormat || 'jpeg'
    }
  }

  private buildRemoveBackgroundParams(painting: PpioProviderParams): Record<string, unknown> {
    return {
      image: painting.imageFile
    }
  }

  private buildEraserParams(input: PollingSubmitInput, painting: PpioProviderParams): Record<string, unknown> {
    // Bespoke omitted `prompt` entirely when unset; preserve that (eraser is
    // one of the no-prompt models, so an empty string would change the body).
    return {
      image: painting.imageFile,
      mask: painting.ppioMask,
      ...(input.prompt ? { prompt: input.prompt } : {}),
      output_format: painting.outputFormat || 'jpeg'
    }
  }

  async getTaskResult(taskId: string, timeout: number = 120000, signal?: AbortSignal): Promise<PpioTaskResult> {
    const endpoint = `/v3/async/task-result?task_id=${encodeURIComponent(taskId)}`
    return this.request<PpioTaskResult>(endpoint, {}, 'GET', timeout, signal)
  }

  async poll(
    taskId: string,
    options: { signal?: AbortSignal; onProgress?: (progress: number) => void }
  ): Promise<string[]> {
    const result = await this.pollTaskResult(taskId, options)
    return (result.images ?? []).map((img) => img.image_url)
  }

  async pollTaskResult(
    taskId: string,
    options?: {
      interval?: number
      maxAttempts?: number
      onProgress?: (progress: number) => void
      signal?: AbortSignal
    }
  ): Promise<PpioTaskResult> {
    const { interval, maxAttempts = 120, onProgress, signal } = options || {}
    const maxTransientRetries = 10
    let attempts = 0
    let transientRetries = 0
    const startTime = Date.now()

    while (attempts < maxAttempts) {
      if (signal?.aborted) {
        throw createAbortError('Task polling aborted')
      }

      try {
        const result = await this.getTaskResult(taskId, 10000, signal)
        transientRetries = 0

        if (result.task.progress_percent !== undefined && onProgress) {
          onProgress(result.task.progress_percent)
        }

        if (result.task.status === 'TASK_STATUS_SUCCEED') {
          return result
        }

        if (result.task.status === 'TASK_STATUS_FAILED') {
          throw new Error(result.task.reason || 'Task failed')
        }
      } catch (error) {
        if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
          throw createAbortError('Task polling aborted')
        }

        if (error instanceof PpioApiError) {
          throw error
        }

        if (error instanceof Error && error.message.includes('Task failed')) {
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
}

export function createPpioTransport(settings: PpioTransportSettings): PpioTransport {
  return new PpioTransport(settings)
}

export type { PpioTransport }
