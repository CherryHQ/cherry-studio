import { loggerService } from '@logger'
import { CacheService } from '@renderer/services/CacheService'
import { FileMetadata, TokenFluxPainting } from '@renderer/types'

import type { TokenFluxModel } from '../config/tokenFluxConfig'

const logger = loggerService.withContext('TokenFluxService')

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

  /**
   * Fetch available models from TokenFlux API
   */
  async fetchModels(): Promise<TokenFluxModel[]> {
    const cacheKey = `tokenflux_models_${this.apiHost}`

    // Check cache first
    const cachedModels = CacheService.get<TokenFluxModel[]>(cacheKey)
    if (cachedModels) {
      return cachedModels
    }

    const response = await fetch(`${this.apiHost}/v1/images/models`, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`
      }
    })

    const data: TokenFluxModelsResponse = await this.handleResponse(response)

    if (!data.success || !data.data) {
      throw new Error('Failed to fetch models')
    }

    // Cache for 60 minutes (3,600,000 milliseconds)
    CacheService.set(cacheKey, data.data, 60 * 60 * 1000)

    return data.data
  }

  /**
   * Create a new image generation request
   */
  async createGeneration(request: TokenFluxGenerationRequest, signal?: AbortSignal): Promise<string> {
    const response = await fetch(`${this.apiHost}/v1/images/generations`, {
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

  /**
   * Get the status and result of a generation
   */
  async getGenerationResult(generationId: string): Promise<TokenFluxGenerationResponse['data']> {
    const response = await fetch(`${this.apiHost}/v1/images/generations/${generationId}`, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`
      }
    })

    const data: TokenFluxGenerationResponse = await this.handleResponse(response)

    if (!data.success || !data.data) {
      throw new Error('Invalid response from generation service')
    }

    return data.data
  }

  /**
   * Poll for generation result with automatic retry logic
   */
  async pollGenerationResult(
    generationId: string,
    options: {
      onStatusUpdate?: (updates: Partial<TokenFluxPainting>) => void
      maxRetries?: number
      timeoutMs?: number
      intervalMs?: number
    } = {}
  ): Promise<TokenFluxGenerationResponse['data']> {
    const {
      onStatusUpdate,
      maxRetries = 10,
      timeoutMs = 120000, // 2 minutes
      intervalMs = 2000
    } = options

    const startTime = Date.now()
    let retryCount = 0

    return new Promise((resolve, reject) => {
      const poll = async () => {
        try {
          // Check for timeout
          if (Date.now() - startTime > timeoutMs) {
            reject(new Error('Image generation timed out. Please try again.'))
            return
          }

          const result = await this.getGenerationResult(generationId)

          // Reset retry count on successful response
          retryCount = 0

          if (result) {
            onStatusUpdate?.({ status: result.status as TokenFluxPainting['status'] })

            if (result.status === 'succeeded') {
              resolve(result)
              return
            } else if (result.status === 'failed') {
              reject(new Error('Image generation failed'))
              return
            }
          }

          // Continue polling for other statuses (processing, queued, etc.)
          setTimeout(poll, intervalMs)
        } catch (error) {
          logger.error('Polling error:', error as Error)
          retryCount++

          if (retryCount >= maxRetries) {
            reject(new Error('Failed to check generation status after multiple attempts. Please try again.'))
            return
          }

          // Retry after interval
          setTimeout(poll, intervalMs)
        }
      }

      // Start polling
      poll()
    })
  }

  /**
   * Create generation and poll for result in one call
   */
  async generateAndWait(
    request: TokenFluxGenerationRequest,
    options: {
      onStatusUpdate?: (updates: Partial<TokenFluxPainting>) => void
      signal?: AbortSignal
      maxRetries?: number
      timeoutMs?: number
      intervalMs?: number
    } = {}
  ): Promise<TokenFluxGenerationResponse['data']> {
    const { signal, onStatusUpdate, ...pollOptions } = options
    const generationId = await this.createGeneration(request, signal)
    if (onStatusUpdate) {
      onStatusUpdate({ generationId })
    }
    return this.pollGenerationResult(generationId, { ...pollOptions, onStatusUpdate })
  }

  async downloadImages(urls: string[]) {
    const downloadedFiles = await Promise.all(
      urls.map(async (url) => {
        try {
          if (!url?.trim()) {
            logger.error('Image URL is empty')
            window.message.warning({
              content: 'Image URL is empty',
              key: 'empty-url-warning'
            })
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
