import { loggerService } from '@logger'

import type { PpioPaintingData as PpioPainting } from '../../model/types/paintingData'
import { getModelConfig } from './config'

const logger = loggerService.withContext('PpioService')

const PPIO_API_HOST = 'https://api.ppio.com'

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

class PpioService {
  private apiKey: string

  constructor(apiKey: string) {
    this.apiKey = apiKey
  }

  private async request<T>(
    endpoint: string,
    body: Record<string, unknown>,
    method: 'POST' | 'GET' = 'POST',
    timeout: number = 120000,
    externalSignal?: AbortSignal
  ): Promise<T> {
    const url = `${PPIO_API_HOST}${endpoint}`
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
        const errorText = await response.text()
        logger.error('PPIO API error', { status: response.status, error: errorText })
        throw new PpioApiError(`PPIO API error: ${response.status} - ${errorText}`, response.status)
      }

      const data = await response.json()
      logger.debug('PPIO API response', data)
      return data as T
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        if (externallyAborted) {
          throw createAbortError('PPIO API request aborted')
        }

        logger.error('PPIO API request timeout', { endpoint, timeout })
        throw new Error(`PPIO API request timeout after ${timeout / 1000}s`)
      }
      throw error
    } finally {
      clearTimeout(timeoutId)
      externalSignal?.removeEventListener('abort', onExternalAbort)
    }
  }

  async generate(painting: PpioPainting, signal?: AbortSignal): Promise<{ taskId?: string; images?: string[] }> {
    const modelConfig = getModelConfig(painting.model || '')
    if (!modelConfig) {
      throw new Error(`Unknown model: ${painting.model}`)
    }

    const params = this.buildRequestParams(painting, modelConfig.id)

    if (modelConfig.isSync) {
      const result = await this.request<PpioSyncResult>(modelConfig.endpoint, params, 'POST', 120000, signal)
      return { images: result.images }
    }

    const result = await this.request<{ task_id: string }>(modelConfig.endpoint, params, 'POST', 120000, signal)
    return { taskId: result.task_id }
  }

  private buildRequestParams(painting: PpioPainting, modelId: string): Record<string, unknown> {
    const params: Record<string, unknown> = {}

    if (painting.prompt) {
      params.prompt = painting.prompt
    }

    switch (modelId) {
      case 'jimeng-txt2img-v3.1':
      case 'jimeng-txt2img-v3.0':
        return this.buildJimengParams(painting)
      case 'hunyuan-image-3':
        return this.buildHunyuanParams(painting)
      case 'qwen-image-txt2img':
        return this.buildQwenTxt2ImgParams(painting)
      case 'qwen-image-edit':
        return this.buildQwenEditParams(painting)
      case 'z-image-turbo':
        return this.buildZImageParams(painting)
      case 'z-image-turbo-lora':
        return this.buildZImageLoraParams(painting)
      case 'seedream-4.5-draw':
      case 'seedream-4.0-draw':
        return this.buildSeedreamDrawParams(painting)
      case 'seedream-4.5-edit':
      case 'seedream-4.0-edit':
        return this.buildSeedreamEditParams(painting)
      case 'image-upscaler':
        return this.buildUpscalerParams(painting)
      case 'image-remove-background':
        return this.buildRemoveBackgroundParams(painting)
      case 'image-eraser':
        return this.buildEraserParams(painting)
      default:
        return params
    }
  }

  private buildJimengParams(painting: PpioPainting): Record<string, unknown> {
    const params: Record<string, unknown> = {
      prompt: painting.prompt,
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

  private buildHunyuanParams(painting: PpioPainting): Record<string, unknown> {
    return {
      prompt: painting.prompt,
      size: painting.size?.replace('x', '*') || '1024*1024',
      seed: painting.ppioSeed ?? -1,
      watermark: painting.addWatermark ?? false
    }
  }

  private buildQwenTxt2ImgParams(painting: PpioPainting): Record<string, unknown> {
    return {
      prompt: painting.prompt,
      size: painting.size?.replace('x', '*') || '1024*1024',
      watermark: painting.addWatermark ?? false
    }
  }

  private buildQwenEditParams(painting: PpioPainting): Record<string, unknown> {
    return {
      prompt: painting.prompt,
      image: painting.imageFile,
      seed: painting.ppioSeed ?? -1,
      output_format: painting.outputFormat || 'jpeg',
      watermark: painting.addWatermark ?? false
    }
  }

  private buildZImageParams(painting: PpioPainting): Record<string, unknown> {
    return {
      prompt: painting.prompt,
      size: painting.size?.replace('x', '*') || '1024*1024',
      seed: painting.ppioSeed ?? -1
    }
  }

  private buildZImageLoraParams(painting: PpioPainting): Record<string, unknown> {
    return {
      prompt: painting.prompt,
      size: painting.size?.replace('x', '*') || '1024*1024',
      seed: painting.ppioSeed ?? -1,
      loras: []
    }
  }

  private buildSeedreamDrawParams(painting: PpioPainting): Record<string, unknown> {
    return {
      prompt: painting.prompt,
      size: painting.size || '2048x2048',
      watermark: painting.addWatermark ?? true,
      sequential_image_generation: 'disabled'
    }
  }

  private buildSeedreamEditParams(painting: PpioPainting): Record<string, unknown> {
    return {
      prompt: painting.prompt,
      image: painting.imageFile ? [painting.imageFile] : [],
      size: painting.size || '2048x2048',
      watermark: painting.addWatermark ?? true,
      sequential_image_generation: 'disabled'
    }
  }

  private buildUpscalerParams(painting: PpioPainting): Record<string, unknown> {
    return {
      image: painting.imageFile,
      resolution: painting.resolution || '4k',
      output_format: painting.outputFormat || 'jpeg'
    }
  }

  private buildRemoveBackgroundParams(painting: PpioPainting): Record<string, unknown> {
    return {
      image: painting.imageFile
    }
  }

  private buildEraserParams(painting: PpioPainting): Record<string, unknown> {
    return {
      image: painting.imageFile,
      mask: painting.ppioMask,
      prompt: painting.prompt,
      output_format: painting.outputFormat || 'jpeg'
    }
  }

  async getTaskResult(taskId: string, timeout: number = 120000, signal?: AbortSignal): Promise<PpioTaskResult> {
    logger.debug('PPIO get task result', { taskId })
    const endpoint = `/v3/async/task-result?task_id=${encodeURIComponent(taskId)}`
    return this.request<PpioTaskResult>(endpoint, {}, 'GET', timeout, signal)
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
    let attempts = 0
    const startTime = Date.now()

    while (attempts < maxAttempts) {
      if (signal?.aborted) {
        throw createAbortError('Task polling aborted')
      }

      try {
        const result = await this.getTaskResult(taskId, 10000, signal)

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
          logger.error('PPIO API error, stop polling', { taskId, statusCode: error.statusCode })
          throw error
        }

        if (error instanceof Error && error.message.includes('Task failed')) {
          throw error
        }

        logger.warn('PPIO task polling request failed, will retry', {
          taskId,
          attempts: attempts + 1,
          maxAttempts,
          error: error instanceof Error ? error.message : String(error)
        })
      }

      const elapsedTime = Date.now() - startTime
      const pollDelay = interval ?? (elapsedTime < 60000 ? 3000 : 10000)
      await waitWithSignal(pollDelay, signal)
      attempts++
    }

    throw new Error('Task polling timeout')
  }
}

export default PpioService
