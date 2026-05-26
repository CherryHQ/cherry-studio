import type { ImageGenerationSubmitInput, ImageGenerationTransport } from '../imageGenerationModel'

/**
 * OVMS (OpenVINO Model Server) single-shot transport.
 *
 * Relocated verbatim from the legacy painting service
 * (`src/renderer/src/pages/paintings/providers/ovms/generate.ts`): single
 * `${apiHost}/images/generations` (NO `/v1`), NO auth header, JSON body
 * `{model,prompt,size,num_inference_steps,rng_seed}`, response
 * `data.data[]` b64_json → `data:` strings else url. OVMS responds
 * synchronously, so this transport only implements `submit()`. `apiHost` is
 * the local OpenVINO host (no pinned default).
 */

export const DEFAULT_OVMS_BASE_URL = 'http://localhost:8000'

/**
 * OVMS painting fields forwarded through `providerOptions['ovms']`.
 * Mirrors the `OvmsPaintingData` subset the legacy request consumed.
 */
export interface OvmsProviderParams {
  model?: string
  size?: string
  numInferenceSteps?: number
  rngSeed?: number
}

export interface OvmsTransportSettings {
  baseURL?: string
}

class OvmsTransport implements ImageGenerationTransport {
  private baseURL: string

  constructor(settings: OvmsTransportSettings) {
    this.baseURL = settings.baseURL || DEFAULT_OVMS_BASE_URL
  }

  async submit(input: ImageGenerationSubmitInput): Promise<{ taskId?: string; imageUrls?: string[] }> {
    const params = input.providerParams as OvmsProviderParams

    const requestBody = {
      model: params.model,
      prompt: input.prompt ?? '',
      size: params.size || '512x512',
      num_inference_steps: params.numInferenceSteps || 4,
      rng_seed: params.rngSeed || 0
    }

    const response = await fetch(`${this.baseURL}/images/generations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: input.signal
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: { message: `HTTP ${response.status}` } }))
      throw new Error(errorData.error?.message || 'Image generation failed')
    }

    const data = await response.json()
    const items = Array.isArray(data?.data) ? data.data : []

    const base64s = items
      .filter((item: { b64_json?: string }) => item.b64_json)
      .map((item: { b64_json: string }) => `data:image/png;base64,${item.b64_json}`)
    if (base64s.length > 0) {
      return { imageUrls: base64s }
    }

    const urls = items.filter((item: { url?: string }) => item.url).map((item: { url: string }) => item.url)
    return { imageUrls: urls }
  }
}

export function createOvmsTransport(settings: OvmsTransportSettings): OvmsTransport {
  return new OvmsTransport(settings)
}

export type { OvmsTransport }
