import type { ImageGenerationSubmitInput, ImageGenerationTransport } from '../imageGenerationModel'

/**
 * TokenFlux submit/poll transport.
 *
 * Relocated verbatim from the legacy painting service
 * (`src/renderer/src/pages/paintings/providers/tokenflux/service.ts`):
 * same API host, 2s poll interval, 120s timeout, `maxRetries` 10,
 * `'succeeded'`/`'failed'` status mapping and `handleResponse` shape. The
 * `fetchModels`/1h cache stays catalog-side (UI/model list), not here.
 */

export const DEFAULT_TOKENFLUX_BASE_URL = 'https://api.tokenflux.ai'

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

export interface TokenFluxProviderParams {
  model?: string
  inputParams?: Record<string, unknown>
  onProgress?: (progress: number) => void
}

export interface TokenFluxTransportSettings {
  apiKey: string
  baseURL?: string
}

class TokenFluxTransport implements ImageGenerationTransport {
  private apiKey: string
  private baseURL: string

  constructor(settings: TokenFluxTransportSettings) {
    this.apiKey = settings.apiKey
    this.baseURL = settings.baseURL || DEFAULT_TOKENFLUX_BASE_URL
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
      throw new Error(errorData.message || `HTTP ${response.status}: Request failed`)
    }
    return response.json().catch(() => {
      throw new Error(`HTTP ${response.status}: Invalid response from server`)
    })
  }

  async submit(input: ImageGenerationSubmitInput): Promise<{ taskId?: string; imageUrls?: string[] }> {
    const params = input.providerParams as TokenFluxProviderParams
    const request: TokenFluxGenerationRequest = {
      model: input.modelId,
      input: {
        prompt: input.prompt ?? '',
        ...params.inputParams
      }
    }
    const generationId = await this.createGeneration(request, input.signal)
    return { taskId: generationId }
  }

  async createGeneration(request: TokenFluxGenerationRequest, signal?: AbortSignal): Promise<string> {
    const response = await fetch(`${this.baseURL}/v1/images/generations`, {
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
    const response = await fetch(`${this.baseURL}/v1/images/generations/${generationId}`, {
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

  async poll(
    taskId: string,
    options: { signal?: AbortSignal; onProgress?: (progress: number) => void }
  ): Promise<string[]> {
    const result = await this.pollGenerationResult(taskId, { signal: options.signal })
    return (result?.images ?? []).map((img) => img.url)
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
}

export function createTokenFluxTransport(settings: TokenFluxTransportSettings): TokenFluxTransport {
  return new TokenFluxTransport(settings)
}

export type { TokenFluxTransport }
