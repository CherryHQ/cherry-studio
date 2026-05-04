import { loggerService } from '@logger'
import type { FileMetadata } from '@renderer/types'
import md5 from 'md5'

import type { TokenFluxModel } from './config'

const logger = loggerService.withContext('TokenFluxService')

const TOKENFLUX_IMAGE_API_HOST = 'https://api.tokenflux.ai'
const TOKENFLUX_MODELS_CACHE_TTL_MS = 60 * 60 * 1000

const modelsCache = new Map<string, { expiresAt: number; models: TokenFluxModel[] }>()

function createAbortError(message: string): Error {
  const error = new Error(message)
  error.name = 'AbortError'
  return error
}

export interface TokenFluxGenerationRequest {
  model: string
  input: {
    prompt: string
    [key: string]: any
  }
}

export interface TokenFluxGenerationResponse {
  success: boolean
  data?: {
    id: string
    status: string
    images?: Array<{ url: string }>
  }
  message?: string
}

export interface TokenFluxModelsResponse {
  success: boolean
  data?: TokenFluxModel[]
  message?: string
}

export class TokenFluxService {
  private apiHost: string
  private apiKey: string

  constructor(apiHost: string, apiKey: string) {
    this.apiHost = apiHost
    this.apiKey = apiKey
  }

  private getHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json'
    }
  }

  private async handleResponse<T>(response: Response): Promise<T> {
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ message: 'Unknown error' }))
      throw new Error(errorData.message || `HTTP ${response.status}: Request failed`)
    }
    return response.json()
  }

  async fetchModels(): Promise<TokenFluxModel[]> {
    const cacheKey = `tokenflux_models_${this.apiHost}_${md5(this.apiKey || 'anonymous')}`
    const cachedModels = modelsCache.get(cacheKey)
    if (cachedModels && cachedModels.expiresAt > Date.now()) {
      return cachedModels.models
    }

    const response = await fetch(`${TOKENFLUX_IMAGE_API_HOST}/v1/images/models`, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`
      }
    })

    const data: TokenFluxModelsResponse = await this.handleResponse(response)

    if (!data.success || !data.data) {
      throw new Error('Failed to fetch models')
    }

    modelsCache.set(cacheKey, {
      expiresAt: Date.now() + TOKENFLUX_MODELS_CACHE_TTL_MS,
      models: data.data
    })

    return data.data
  }

  async createGeneration(request: TokenFluxGenerationRequest, signal?: AbortSignal): Promise<string> {
    const response = await fetch(`${TOKENFLUX_IMAGE_API_HOST}/v1/images/generations`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(request),
      signal
    })

    const data: TokenFluxGenerationResponse = await this.handleResponse(response)

    if (!data.success || !data.data?.id) {
      throw new Error(data.message || 'Generation failed')
    }

    return data.data.id
  }

  async getGenerationResult(generationId: string, signal?: AbortSignal): Promise<TokenFluxGenerationResponse['data']> {
    const response = await fetch(`${TOKENFLUX_IMAGE_API_HOST}/v1/images/generations/${generationId}`, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`
      },
      signal
    })

    const data: TokenFluxGenerationResponse = await this.handleResponse(response)

    if (!data.success || !data.data) {
      throw new Error('Invalid response from generation service')
    }

    return data.data
  }

  async pollGenerationResult(
    generationId: string,
    options: {
      onStatusUpdate?: (status: string) => void
      signal?: AbortSignal
      maxRetries?: number
      timeoutMs?: number
      intervalMs?: number
    } = {}
  ): Promise<TokenFluxGenerationResponse['data']> {
    const { onStatusUpdate, signal, maxRetries = 10, timeoutMs = 120000, intervalMs = 2000 } = options

    const startTime = Date.now()
    let retryCount = 0

    return new Promise((resolve, reject) => {
      let timeoutId: ReturnType<typeof setTimeout> | undefined
      let settled = false

      const finish = (handler: typeof resolve | typeof reject, value: unknown) => {
        if (settled) return
        settled = true
        if (timeoutId) {
          clearTimeout(timeoutId)
        }
        signal?.removeEventListener('abort', onAbort)
        handler(value as never)
      }

      const onAbort = () => {
        finish(reject, createAbortError('Image generation aborted'))
      }

      if (signal?.aborted) {
        onAbort()
        return
      }

      signal?.addEventListener('abort', onAbort, { once: true })

      const scheduleNext = () => {
        if (signal?.aborted) {
          onAbort()
          return
        }
        timeoutId = setTimeout(() => {
          void poll()
        }, intervalMs)
      }

      const poll = async () => {
        try {
          if (signal?.aborted) {
            onAbort()
            return
          }

          if (Date.now() - startTime > timeoutMs) {
            finish(reject, new Error('Image generation timed out. Please try again.'))
            return
          }

          const result = await this.getGenerationResult(generationId, signal)
          retryCount = 0

          if (result) {
            onStatusUpdate?.(result.status)

            if (result.status === 'succeeded') {
              finish(resolve, result)
              return
            }
            if (result.status === 'failed') {
              finish(reject, new Error('Image generation failed'))
              return
            }
          }

          scheduleNext()
        } catch (error) {
          if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
            onAbort()
            return
          }

          logger.error('Polling error:', error as Error)
          retryCount++

          if (retryCount >= maxRetries) {
            finish(reject, new Error('Failed to check generation status after multiple attempts. Please try again.'))
            return
          }

          scheduleNext()
        }
      }

      void poll()
    })
  }

  async generateAndWait(
    request: TokenFluxGenerationRequest,
    options: {
      onStatusUpdate?: (status: string) => void
      signal?: AbortSignal
      maxRetries?: number
      timeoutMs?: number
      intervalMs?: number
    } = {}
  ): Promise<TokenFluxGenerationResponse['data']> {
    const { signal, onStatusUpdate, ...pollOptions } = options
    const generationId = await this.createGeneration(request, signal)
    return this.pollGenerationResult(generationId, { ...pollOptions, onStatusUpdate, signal })
  }

  async downloadImages(urls: string[]) {
    const downloadedFiles = await Promise.all(
      urls.map(async (url) => {
        try {
          if (!url?.trim()) {
            logger.error('Image URL is empty')
            window.toast.warning('Image URL is empty')
            return null
          }
          return await window.api.file.download(url)
        } catch (error) {
          logger.error('Failed to download image:', error as Error)
          return null
        }
      })
    )

    return downloadedFiles.filter((file): file is FileMetadata => file !== null)
  }
}

export default TokenFluxService
