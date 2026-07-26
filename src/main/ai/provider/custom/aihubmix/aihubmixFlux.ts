import type { FetchFunction } from '@ai-sdk/provider-utils'
import type { VendorBag } from '@main/ai/utils/imageOptions'
import { t } from '@main/i18n'
import { createPaintingGenerateError } from '@shared/ai/paintingGenerateError'

import type { ImageGenerationSubmitInput, ImageGenerationTransport } from '../imageGenerationModel'
import { readErrorMessage } from '../readErrorMessage'
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
 * Field sourcing — `aspectRatio` / `seed` / `files` arrive on the typed submit input;
 * `safetyTolerance` is the one vendor knob, and it is a catalog key so
 * `imageParamsSchema` has already coerced it to an int.
 */
export interface AihubmixFluxTransportSettings {
  apiRoot: string
  apiKey: string
  fetch?: FetchFunction
}

const POLL_INTERVAL_MS = 2_000
const MAX_WAIT_MS = 5 * 60_000

/** The one vendor knob BFL takes beyond the native params. */
export type AihubmixFluxBag = Pick<VendorBag, 'safetyTolerance'>

class AihubmixFluxTransport implements ImageGenerationTransport<AihubmixFluxBag> {
  private settings: AihubmixFluxTransportSettings
  constructor(settings: AihubmixFluxTransportSettings) {
    this.settings = settings
  }

  async submit(input: ImageGenerationSubmitInput<AihubmixFluxBag>): Promise<{ taskId: string }> {
    const inputBody: Record<string, unknown> = {}
    if (input.prompt) inputBody.prompt = input.prompt

    // One canonical read each. `aspectRatio` is already normalized to `X:Y` by the
    // native binding's `map`, `seed` is the native channel, and `safetyTolerance` is an
    // `optInt` catalog key the IPC boundary already coerced. The previous four-arm
    // probe chain (`aspect_ratio ?? aspectRatio`, three `seed` arms, `safetyTolerance ??
    // safety_tolerance`) laundered all three through the bag; only the caller-stamped
    // `aspect_ratio` could ever arrive, and only because the caller stamped it.
    if (input.aspectRatio) inputBody.aspect_ratio = input.aspectRatio
    if (input.seed !== undefined) inputBody.seed = input.seed
    if (input.providerParams.safetyTolerance !== undefined) {
      inputBody.safety_tolerance = input.providerParams.safetyTolerance
    }

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
      const message = await readErrorMessage(response, t('paintings.generate_failed'))
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
          const message = await readErrorMessage(response, t('paintings.generate_failed'))
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
