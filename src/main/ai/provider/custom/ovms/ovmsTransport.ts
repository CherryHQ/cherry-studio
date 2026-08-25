import type { ImageGenerationSubmitInput, ImageGenerationTransport } from '../imageGenerationModel'

/**
 * OVMS (OpenVINO Model Server) single-shot transport.
 *
 * POSTs `${apiHost}/images/generations` (no `/v1`, no auth) with body
 * `{model,prompt,size,num_inference_steps,rng_seed}`. OVMS responds
 * synchronously, so this transport only implements `submit()`. `apiHost` is
 * the local OpenVINO host (no pinned default).
 *
 * Field sourcing under the unified-schema flow:
 *   - `size` comes from AI SDK `input.size` (canonicalGenerate's
 *     POSITIONAL_RENAME routes `params.size → aiSdkParams.imageSize → AI SDK
 *     options.size → input.size`).
 *   - `num_inference_steps` comes from the providerOptions bag. OVMS rides the
 *     in-SDK path, so its bag is the WireProfile diffusion profile's snake_case
 *     wire body — the profile wire-names `numInferenceSteps → num_inference_steps`
 *     and `passthroughExtras` strips the camelCase twin, so the bag carries the
 *     snake form only.
 *   - `rng_seed` is OVMS's bespoke wire name for seed; sourced from the native
 *     `input.seed`.
 */

export const DEFAULT_OVMS_BASE_URL = 'http://localhost:8000'

export interface OvmsTransportSettings {
  baseURL?: string
}

class OvmsTransport implements ImageGenerationTransport {
  private baseURL: string

  constructor(settings: OvmsTransportSettings) {
    this.baseURL = settings.baseURL || DEFAULT_OVMS_BASE_URL
  }

  async submit(input: ImageGenerationSubmitInput): Promise<{ taskId?: string; imageUrls?: string[] }> {
    const bag = input.providerParams ?? {}

    // OVMS is the in-SDK (createImageGenerationModel) path, so its bag is the
    // WireProfile diffusion profile's snake_case wire body (camelCase twin
    // stripped by passthroughExtras). Native size/seed come from `input.*`.
    const requestBody = {
      model: input.modelId,
      prompt: input.prompt ?? '',
      size: input.size ?? '512x512',
      num_inference_steps: typeof bag.num_inference_steps === 'number' ? bag.num_inference_steps : 4,
      rng_seed: input.seed ?? 0
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
