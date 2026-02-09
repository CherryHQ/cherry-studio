import { loggerService } from '@logger'
import type { PpioPainting } from '@renderer/types'

import { getModelConfig } from '../config/ppioConfig'

const logger = loggerService.withContext('PpioService')

const PPIO_API_HOST = 'https://api.ppio.com'

// 任务状态
export type PpioTaskStatus =
  | 'TASK_STATUS_QUEUED'
  | 'TASK_STATUS_PROCESSING'
  | 'TASK_STATUS_SUCCEED'
  | 'TASK_STATUS_FAILED'

// 任务结果响应
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

// 同步 API 响应（Seedream）
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
    timeout: number = 120000 // 默认 2 分钟超时
  ): Promise<T> {
    const url = `${PPIO_API_HOST}${endpoint}`

    // 创建 AbortController 用于超时控制
    const controller = new AbortController()
    const timeoutId = setTimeout(() => {
      controller.abort()
    }, timeout)

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
        throw new Error(`PPIO API error: ${response.status} - ${errorText}`)
      }

      const data = await response.json()
      logger.debug('PPIO API response', data)
      return data as T
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        logger.error('PPIO API request timeout', { endpoint, timeout })
        throw new Error(`PPIO API request timeout after ${timeout / 1000}s`)
      }
      throw error
    } finally {
      // 清理超时定时器
      clearTimeout(timeoutId)
    }
  }

  /**
   * 通用生成方法 - 根据模型自动选择正确的 API
   */
  async generate(painting: PpioPainting): Promise<{ taskId?: string; images?: string[] }> {
    const modelConfig = getModelConfig(painting.model || '')
    if (!modelConfig) {
      throw new Error(`Unknown model: ${painting.model}`)
    }

    const params = this.buildRequestParams(painting, modelConfig.id)

    if (modelConfig.isSync) {
      // 同步 API（Seedream）
      const result = await this.request<PpioSyncResult>(modelConfig.endpoint, params)
      return { images: result.images }
    } else {
      // 异步 API
      const result = await this.request<{ task_id: string }>(modelConfig.endpoint, params)
      return { taskId: result.task_id }
    }
  }

  /**
   * 根据模型构建请求参数
   */
  private buildRequestParams(painting: PpioPainting, modelId: string): Record<string, unknown> {
    const params: Record<string, unknown> = {}

    // 通用参数
    if (painting.prompt) {
      params.prompt = painting.prompt
    }

    // 根据模型类型构建特定参数
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

    // 解析尺寸
    if (painting.size) {
      const [width, height] = painting.size.split('x').map(Number)
      if (width && height) {
        params.width = width
        params.height = height
      }
    }

    // 水印配置
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
      loras: [] // 暂不支持 LoRA 配置
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

  /**
   * 查询任务结果
   */
  async getTaskResult(taskId: string): Promise<PpioTaskResult> {
    const url = `${PPIO_API_HOST}/v3/async/task-result?task_id=${encodeURIComponent(taskId)}`

    logger.debug('PPIO get task result', { taskId })

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`
      }
    })

    if (!response.ok) {
      const errorText = await response.text()
      logger.error('PPIO get task result error', { status: response.status, error: errorText })
      throw new Error(`PPIO API error: ${response.status} - ${errorText}`)
    }

    const data = await response.json()
    logger.debug('PPIO task result', data)
    return data as PpioTaskResult
  }

  /**
   * 轮询任务结果直到完成
   */
  async pollTaskResult(
    taskId: string,
    options?: {
      interval?: number
      maxAttempts?: number
      onProgress?: (progress: number) => void
      signal?: AbortSignal
    }
  ): Promise<PpioTaskResult> {
    const { interval = 2000, maxAttempts = 120, onProgress, signal } = options || {}

    let attempts = 0

    while (attempts < maxAttempts) {
      if (signal?.aborted) {
        throw new Error('Task polling aborted')
      }

      const result = await this.getTaskResult(taskId)

      if (result.task.progress_percent !== undefined && onProgress) {
        onProgress(result.task.progress_percent)
      }

      if (result.task.status === 'TASK_STATUS_SUCCEED') {
        return result
      }

      if (result.task.status === 'TASK_STATUS_FAILED') {
        throw new Error(result.task.reason || 'Task failed')
      }

      // 等待后继续轮询
      await new Promise((resolve) => setTimeout(resolve, interval))
      attempts++
    }

    throw new Error('Task polling timeout')
  }
}

export default PpioService
