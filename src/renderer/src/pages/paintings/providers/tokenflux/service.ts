import { loggerService } from '@logger'
import type { FileMetadata } from '@renderer/types'

import { createPaintingGenerateError } from '../../model/paintingGenerateError'
import bundledCatalog from './catalog.json'
import type { TokenFluxModel } from './config'

const logger = loggerService.withContext('TokenFluxService')

const TOKENFLUX_IMAGE_API_HOST = 'https://api.tokenflux.ai'
const TOKENFLUX_DOWNLOAD_TIMEOUT_MS = 120000

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(createPaintingGenerateError('REMOTE_ERROR', { message }))
    }, timeoutMs)

    promise.then(
      (value) => {
        clearTimeout(timeoutId)
        resolve(value)
      },
      (error) => {
        clearTimeout(timeoutId)
        reject(error)
      }
    )
  })
}

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

export class TokenFluxService {
  private apiKey: string

  constructor(_apiHost: string, apiKey: string) {
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
      const errorData = await response.json().catch(() => ({ message: '' }))
      throw createPaintingGenerateError('REMOTE_ERROR', {
        message: errorData.message || `HTTP ${response.status}: Request failed`
      })
    }
    return response.json().catch(() => {
      throw createPaintingGenerateError('REMOTE_ERROR', {
        message: `HTTP ${response.status}: Invalid response from server`
      })
    })
  }

  /**
   * Return TokenFlux's painting catalog (model id, name, input_schema, etc.).
   *
   * Historically this hit `https://api.tokenflux.ai/v1/images/models` on every
   * painting-page open — required an apiKey for `Authorization: Bearer`,
   * blocked offline use, and produced a loading flash. The catalog is small
   * enough (~200KB, 70 models) and changes rarely enough that bundling it
   * with the app is the right tradeoff. Refresh cadence is now "next app
   * version" via the registry/import pipeline.
   *
   * Kept `async` to preserve the call-site contract — the painting page's
   * async loader path expects a Promise — so future remote refreshes can be
   * dropped in here without a callsite migration.
   */
  async fetchModels(): Promise<TokenFluxModel[]> {
    return bundledCatalog as unknown as TokenFluxModel[]
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
          return await withTimeout(
            window.api.file.download(url),
            TOKENFLUX_DOWNLOAD_TIMEOUT_MS,
            `Image download timed out after ${TOKENFLUX_DOWNLOAD_TIMEOUT_MS / 1000}s`
          )
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
