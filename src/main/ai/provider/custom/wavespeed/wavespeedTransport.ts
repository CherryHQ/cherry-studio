import type { FetchFunction } from '@ai-sdk/provider-utils'

import { t } from '@main/i18n'
import { createPaintingGenerateError, PaintingGenerateError } from '@shared/ai/paintingGenerateError'

import {
  DEFAULT_IMAGE_REQUEST_TIMEOUT_MS,
  type ImageGenerationSubmitInput,
  type ImageGenerationTransport
} from '../imageGenerationModel'
import { readErrorMessage } from '../readErrorMessage'
import { createAbortError, fileToDataUrl, isTerminalHttpStatus, waitWithSignal } from '../transportUtils'

/**
 * WaveSpeed prediction transport (https://wavespeed.ai/docs).
 *
 * `POST /api/v3/<model id>` creates a prediction (the per-mode endpoint comes from the
 * registry's `vendorTransport`); `GET /api/v3/predictions/<id>/result` reports its status.
 * Every response is wrapped in `{ code, message, data }`, and a non-200 `code` is a failure
 * even when the HTTP status is 200. Each submit is billed, so it is never retried.
 */

export const DEFAULT_WAVESPEED_IMAGE_BASE_URL = 'https://api.wavespeed.ai'

const POLL_INTERVAL_MS = 2000
const POLL_BUDGET_MS = 10 * 60_000
const MAX_TRANSIENT_POLL_FAILURES = 10
const TERMINAL_FAILURE_STATUSES = new Set(['failed', 'cancelled', 'timeout', 'deleted'])

interface WavespeedEnvelope<T> {
  code?: number
  message?: string
  data?: T
}

interface WavespeedPrediction {
  id?: string
  status?: string
  outputs?: string[]
  error?: string
}

/** Canonical camelCase params the transport maps onto WaveSpeed's snake_case body. */
export interface WavespeedProviderParams {
  imageResolution?: string
  outputFormat?: string
  background?: string
}

export interface WavespeedTransportSettings {
  apiKey: string
  baseURL?: string
  headers?: Record<string, string>
  fetch?: FetchFunction
}

function buildBody(input: ImageGenerationSubmitInput): Record<string, unknown> {
  const bag = (input.providerParams ?? {}) as WavespeedProviderParams
  const body: Record<string, unknown> = { prompt: input.prompt ?? '' }
  if (input.files?.length) body.images = input.files.map((file) => fileToDataUrl(file))
  if (input.aspectRatio) body.aspect_ratio = input.aspectRatio
  if (bag.imageResolution) body.resolution = bag.imageResolution.toLowerCase()
  if (bag.outputFormat) body.output_format = bag.outputFormat
  if (bag.background) body.background = bag.background
  return body
}

class WavespeedTransport implements ImageGenerationTransport {
  private apiKey: string
  private baseURL: string
  private headers: Record<string, string>
  private customFetch?: FetchFunction

  constructor(settings: WavespeedTransportSettings) {
    this.apiKey = settings.apiKey
    this.baseURL = (settings.baseURL || DEFAULT_WAVESPEED_IMAGE_BASE_URL).replace(/\/+$/, '')
    this.headers = settings.headers ?? {}
    this.customFetch = settings.fetch
  }

  async submit(input: ImageGenerationSubmitInput): Promise<{ taskId: string }> {
    const endpoint = input.modelDescriptor?.endpoint
    if (!endpoint) throw new Error(`Missing modelDescriptor for WaveSpeed image model: ${input.modelId}`)

    const prediction = await this.request(endpoint, buildBody(input), input.signal)
    if (!prediction.id) {
      throw createPaintingGenerateError('REMOTE_ERROR', { message: 'WaveSpeed returned no prediction id' })
    }
    return { taskId: prediction.id }
  }

  async poll(taskId: string, options: { signal?: AbortSignal }): Promise<string[]> {
    const { signal } = options
    const deadline = Date.now() + POLL_BUDGET_MS
    let transientFailures = 0

    while (Date.now() < deadline) {
      await waitWithSignal(POLL_INTERVAL_MS, signal)
      try {
        const prediction = await this.request(
          `/api/v3/predictions/${encodeURIComponent(taskId)}/result`,
          undefined,
          signal
        )
        transientFailures = 0
        if (prediction.status === 'completed') return prediction.outputs ?? []
        if (prediction.status && TERMINAL_FAILURE_STATUSES.has(prediction.status)) {
          throw createPaintingGenerateError('REMOTE_ERROR', {
            message: prediction.error || `WaveSpeed prediction ${prediction.status}`
          })
        }
      } catch (error) {
        if (error instanceof PaintingGenerateError || (error instanceof Error && error.name === 'AbortError')) {
          throw error
        }
        // `request` turns terminal 4xx into PaintingGenerateError, so what remains is 5xx / 429 / network.
        if (++transientFailures >= MAX_TRANSIENT_POLL_FAILURES) throw error
      }
    }

    throw new Error('WaveSpeed prediction polling timed out')
  }

  private async request(
    path: string,
    body: Record<string, unknown> | undefined,
    externalSignal: AbortSignal | undefined
  ): Promise<WavespeedPrediction> {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), DEFAULT_IMAGE_REQUEST_TIMEOUT_MS)
    const onExternalAbort = () => controller.abort()
    if (externalSignal?.aborted) controller.abort()
    else externalSignal?.addEventListener('abort', onExternalAbort, { once: true })

    try {
      const response = await (this.customFetch ?? globalThis.fetch)(`${this.baseURL}${path}`, {
        method: body ? 'POST' : 'GET',
        headers: {
          Accept: 'application/json',
          ...this.headers,
          Authorization: `Bearer ${this.apiKey}`,
          ...(body && { 'Content-Type': 'application/json' })
        },
        ...(body && { body: JSON.stringify(body) }),
        signal: controller.signal
      })
      if (!response.ok) {
        if (response.status === 401) throw createPaintingGenerateError('REQ_ERROR_TOKEN')
        if (isTerminalHttpStatus(response.status)) {
          const message = await readErrorMessage(response, t('paintings.generate_failed'))
          throw createPaintingGenerateError('REMOTE_ERROR', { message })
        }
        const errorText = (await response.text().catch(() => '')).slice(0, 500)
        throw new Error(`WaveSpeed API error: ${response.status} - ${errorText}`)
      }
      const envelope = (await response.json()) as WavespeedEnvelope<WavespeedPrediction>
      if (envelope.code !== 200) {
        throw createPaintingGenerateError('REMOTE_ERROR', {
          message: envelope.message || t('paintings.generate_failed')
        })
      }
      return envelope.data ?? {}
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        if (externalSignal?.aborted) throw createAbortError('WaveSpeed API request aborted')
        throw new Error(`WaveSpeed API request timed out after ${DEFAULT_IMAGE_REQUEST_TIMEOUT_MS / 1000}s`)
      }
      throw error
    } finally {
      clearTimeout(timeoutId)
      externalSignal?.removeEventListener('abort', onExternalAbort)
    }
  }
}

export function createWavespeedTransport(settings: WavespeedTransportSettings): ImageGenerationTransport {
  return new WavespeedTransport(settings)
}
