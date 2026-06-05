import type { FetchFunction } from '@ai-sdk/provider-utils'
import { createPaintingGenerateError } from '@shared/ai/paintingGenerateError'
import { readErrorMessage } from '@shared/ai/readErrorMessage'

import type { ImageGenerationSubmitInput, ImageGenerationTransport } from '../imageGenerationModel'
import { createAbortError, fileToDataUrl, waitWithSignal } from '../transportUtils'

/**
 * AiHubMix BFL async FLUX transport.
 *
 * Backs `flux-2-flex` / `flux-2-pro` / `flux-kontext-max` — three BFL
 * models that aihubmix exposes as task-based async endpoints (the
 * remaining FLUX variants — `FLUX-1.1-pro`, `FLUX.1-Kontext-pro` — are
 * synchronous and stay on the OpenAI-compat default branch).
 *
 * Wire shape (per https://docs.aihubmix.com/cn/api/Image-Gen):
 *   submit : POST `${apiRoot}/v1/models/bfl/<modelId>/predictions`
 *            body  `{ input: { prompt, aspect_ratio?, safety_tolerance?,
 *                              input_image?, seed? } }`
 *            resp  `{ output: [{ taskId, polling_url }] }`
 *   poll   : GET  `${apiRoot}/v1/tasks/<taskId>`
 *            resp  `{ status: 'Pending'|'Ready'|'Error'|…,
 *                     result: { sample: 'https://...' } }`
 *
 * Field sourcing — `aspect_ratio` and `seed` arrive positionally from AI
 * SDK; the rest (`safety_tolerance`) sits in `providerParams` keyed by
 * `safetyTolerance` (Cherry canonical) or `safety_tolerance` (already
 * snake-cased by aihubmixImageModel's bag rename).
 */
export interface AihubmixFluxTransportSettings {
  apiRoot: string
  apiKey: string
  fetch?: FetchFunction
}

const POLL_INTERVAL_MS = 2_000
const MAX_WAIT_MS = 5 * 60_000

function readSafetyTolerance(bag: Record<string, unknown>): number | undefined {
  for (const key of ['safetyTolerance', 'safety_tolerance']) {
    const value = bag[key]
    if (typeof value === 'number') return value
    if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value)
  }
  return undefined
}

function readAspectRatio(bag: Record<string, unknown>, fallback: string | undefined): string | undefined {
  // canonicalGenerate routes aspectRatio through AI SDK positional; modern
  // GeneratePaintingImage normalizes `ASPECT_X_Y` → `X:Y` before doGenerate.
  // Still accept a bag value as a defensive fallback.
  const value = fallback ?? (typeof bag.aspectRatio === 'string' ? bag.aspectRatio : undefined)
  if (!value) return undefined
  const stripped = value.replace(/^ASPECT_/i, '').replace('_', ':')
  return /^\d+:\d+$/.test(stripped) ? stripped : undefined
}

function readSeed(bag: Record<string, unknown>, positional: number | undefined): number | undefined {
  if (typeof positional === 'number') return positional
  const value = bag.seed
  if (typeof value === 'number') return value
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) return Number(value.trim())
  return undefined
}

class AihubmixFluxTransport implements ImageGenerationTransport {
  private settings: AihubmixFluxTransportSettings
  constructor(settings: AihubmixFluxTransportSettings) {
    this.settings = settings
  }

  async submit(input: ImageGenerationSubmitInput): Promise<{ taskId: string }> {
    const bag = input.providerParams ?? {}
    const inputBody: Record<string, unknown> = {}
    if (input.prompt) inputBody.prompt = input.prompt

    const aspect = readAspectRatio(
      bag,
      // aspectRatio gets normalized into `${number}:${number}` upstream and lives
      // on `options.aspectRatio`, but it isn't part of ImageGenerationSubmitInput.
      // Callers that need it pass it via the bag.
      typeof bag.aspect_ratio === 'string' ? bag.aspect_ratio : undefined
    )
    if (aspect) inputBody.aspect_ratio = aspect

    const seed = readSeed(bag, input.seed)
    if (seed !== undefined) inputBody.seed = seed

    const safety = readSafetyTolerance(bag)
    if (safety !== undefined) inputBody.safety_tolerance = safety

    const firstFile = input.files?.[0]
    if (firstFile) inputBody.input_image = fileToDataUrl(firstFile)

    const fetchImpl = this.settings.fetch ?? globalThis.fetch
    const url = `${this.settings.apiRoot}/v1/models/bfl/${input.modelId}/predictions`
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.settings.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ input: inputBody }),
      signal: input.signal
    })

    if (!response.ok) {
      const message = await readErrorMessage(response, 'paintings.generate_failed')
      throw createPaintingGenerateError('REMOTE_ERROR', { message })
    }

    const json = (await response.json()) as { output?: Array<{ taskId?: string; id?: string }> }
    const taskId = json?.output?.[0]?.taskId ?? json?.output?.[0]?.id
    if (!taskId) {
      throw createPaintingGenerateError('REMOTE_ERROR', { message: 'No taskId returned from FLUX submit' })
    }
    return { taskId }
  }

  async poll(taskId: string, options: { signal?: AbortSignal }): Promise<string[]> {
    const fetchImpl = this.settings.fetch ?? globalThis.fetch
    const url = `${this.settings.apiRoot}/v1/tasks/${encodeURIComponent(taskId)}`
    const startedAt = Date.now()
    // Absorb transient poll failures (network blips, transient 5xx) the same
    // way the sibling async transports do (ppio/dashscope/modelscope), so a
    // single hiccup mid-render doesn't abort an otherwise-healthy task.
    // Terminal vendor statuses (Error/Moderated) and timeout/abort still fail
    // immediately.
    const maxTransientRetries = 10
    let transientRetries = 0
    while (true) {
      if (options.signal?.aborted) throw createAbortError('FLUX polling aborted')
      if (Date.now() - startedAt > MAX_WAIT_MS) {
        throw createPaintingGenerateError('REMOTE_ERROR', { message: 'FLUX task timed out' })
      }
      await waitWithSignal(POLL_INTERVAL_MS, options.signal)

      let json: { status?: string; result?: { sample?: string; samples?: string[] }; detail?: string }
      try {
        const response = await fetchImpl(url, {
          method: 'GET',
          headers: { Authorization: `Bearer ${this.settings.apiKey}` },
          signal: options.signal
        })
        if (!response.ok) {
          const message = await readErrorMessage(response, 'paintings.generate_failed')
          throw new Error(message)
        }
        json = (await response.json()) as typeof json
      } catch (error) {
        // Re-raise an abort immediately; otherwise treat as transient and
        // retry up to the bounded ceiling before surfacing the failure.
        if (options.signal?.aborted) throw createAbortError('FLUX polling aborted')
        if (++transientRetries > maxTransientRetries) {
          throw createPaintingGenerateError('REMOTE_ERROR', {
            message: error instanceof Error ? error.message : 'FLUX polling failed'
          })
        }
        continue
      }

      transientRetries = 0
      const status = json?.status
      if (status === 'Ready') {
        const sample = json.result?.sample
        if (typeof sample === 'string') return [sample]
        const samples = json.result?.samples
        if (Array.isArray(samples) && samples.length > 0) return samples
        throw createPaintingGenerateError('REMOTE_ERROR', { message: 'FLUX Ready without a sample URL' })
      }
      if (status === 'Error' || status === 'Request Moderated' || status === 'Content Moderated') {
        throw createPaintingGenerateError('REMOTE_ERROR', { message: json?.detail || String(status) })
      }
      // status === 'Pending' / 'Task not found' / unknown → keep polling
    }
  }
}

export function createAihubmixFluxTransport(settings: AihubmixFluxTransportSettings): AihubmixFluxTransport {
  return new AihubmixFluxTransport(settings)
}

export type { AihubmixFluxTransport }
