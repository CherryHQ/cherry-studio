import { combineHeaders, createJsonResponseHandler, type FetchFunction, postJsonToApi } from '@ai-sdk/provider-utils'
import type { WireVendorBag } from '@main/ai/utils/imageOptions'
import * as z from 'zod'

import type { ImageGenerationSubmitInput } from '../imageTransport'
import {
  completedImageTransportSubmission,
  type ImageTransportInputSupport,
  type ImmediateImageGenerationTransport
} from '../imageTransport'
import { createImageTransportErrorResponseHandler } from '../imageTransportHttp'

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
  headers?: Record<string, string | undefined>
  fetch?: FetchFunction
}

const ovmsImageResponseSchema = z
  .object({
    data: z.array(z.object({ b64_json: z.string().min(1).optional(), url: z.string().min(1).optional() }).passthrough())
  })
  .passthrough()

class OvmsTransport implements ImmediateImageGenerationTransport<WireVendorBag> {
  private readonly baseURL: string
  private readonly headers: Record<string, string | undefined> | undefined
  private readonly fetch: FetchFunction | undefined

  readonly task = { kind: 'unsupported' as const }

  constructor(settings: OvmsTransportSettings) {
    this.baseURL = settings.baseURL || DEFAULT_OVMS_BASE_URL
    this.headers = settings.headers
    this.fetch = settings.fetch
  }

  /** Text-to-image only: the body is model/prompt/size/steps/seed, no image slot. */
  supportsInput(): ImageTransportInputSupport {
    return { files: false, mask: false }
  }

  async submit(input: ImageGenerationSubmitInput<WireVendorBag>) {
    const bag = input.providerParams

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

    const response = await postJsonToApi({
      url: `${this.baseURL}/images/generations`,
      headers: combineHeaders(this.headers, input.headers),
      body: requestBody,
      abortSignal: input.signal,
      fetch: this.fetch,
      failedResponseHandler: createImageTransportErrorResponseHandler(),
      successfulResponseHandler: createJsonResponseHandler(ovmsImageResponseSchema)
    })

    const base64s = response.value.data
      .filter((item): item is typeof item & { b64_json: string } => item.b64_json !== undefined)
      .map((item) => `data:image/png;base64,${item.b64_json}`)
    if (base64s.length > 0) {
      return completedImageTransportSubmission(base64s, 'OVMS')
    }

    const urls = response.value.data
      .filter((item): item is typeof item & { url: string } => item.url !== undefined)
      .map((item) => item.url)
    return completedImageTransportSubmission(urls, 'OVMS')
  }
}

export function createOvmsTransport(settings: OvmsTransportSettings): OvmsTransport {
  return new OvmsTransport(settings)
}

export type { OvmsTransport }
