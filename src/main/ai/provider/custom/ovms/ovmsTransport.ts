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
 *   - `num_inference_steps` comes from the providerOptions bag — either
 *     camelCase `numInferenceSteps` (canonical) or `num_inference_steps`
 *     (snake_case via `buildImageProviderOptions`'s default branch). Read
 *     both for forward/backward compatibility.
 *   - `rng_seed` is OVMS's bespoke wire name for seed. Source from the bag
 *     under any of `rngSeed` / `seed` (camelCase) or `rng_seed`
 *     (snake_case from `buildImageProviderOptions`).
 */

export const DEFAULT_OVMS_BASE_URL = 'http://localhost:8000'

export interface OvmsTransportSettings {
  baseURL?: string
}

function readNumber(bag: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = bag[key]
    if (typeof value === 'number') return value
    if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value)) return Number(value)
  }
  return undefined
}

function readString(bag: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = bag[key]
    if (typeof value === 'string' && value !== '') return value
  }
  return undefined
}

class OvmsTransport implements ImageGenerationTransport {
  private baseURL: string

  constructor(settings: OvmsTransportSettings) {
    this.baseURL = settings.baseURL || DEFAULT_OVMS_BASE_URL
  }

  async submit(input: ImageGenerationSubmitInput): Promise<{ taskId?: string; imageUrls?: string[] }> {
    const bag = input.providerParams ?? {}

    const requestBody = {
      model: input.modelId,
      prompt: input.prompt ?? '',
      size: input.size ?? readString(bag, 'size') ?? '512x512',
      num_inference_steps: readNumber(bag, 'numInferenceSteps', 'num_inference_steps') ?? 4,
      rng_seed: readNumber(bag, 'rngSeed', 'rng_seed', 'seed') ?? input.seed ?? 0
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
