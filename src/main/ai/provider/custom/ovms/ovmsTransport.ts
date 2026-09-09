import { createJsonResponseHandler, type FetchFunction, postJsonToApi } from '@ai-sdk/provider-utils'
import type { VendorBag } from '@main/ai/utils/imageOptions'
import * as z from 'zod'

import type { ImageGenerationSubmitInput } from '../imageTransport'
import {
  completedImageTransportSubmission,
  type ImageTransportInputSupport,
  type ImmediateImageGenerationTransport
} from '../imageTransport'
import { combineImageTransportHeaders, createImageTransportErrorResponseHandler } from '../imageTransportHttp'

/** Single-shot OVMS protocol; keep its existing /images/generations endpoint during the execution refactor. */

export const DEFAULT_OVMS_BASE_URL = 'http://localhost:8000'

export interface OvmsTransportSettings {
  baseURL?: string
  headers?: Record<string, string | undefined>
  fetch?: FetchFunction
}

const ovmsImageResponseSchema = z
  .object({
    data: z.array(z.object({ b64_json: z.string().min(1) }).passthrough()).min(1)
  })
  .passthrough()

class OvmsTransport implements ImmediateImageGenerationTransport<VendorBag> {
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

  async submit(input: ImageGenerationSubmitInput<VendorBag>) {
    const bag = input.providerParams

    const requestBody = {
      model: input.modelId,
      prompt: input.prompt ?? '',
      size: input.size,
      num_inference_steps: bag.numInferenceSteps,
      rng_seed: input.seed
    }

    const response = await postJsonToApi({
      url: `${this.baseURL}/images/generations`,
      headers: combineImageTransportHeaders(this.headers, input.headers),
      body: requestBody,
      abortSignal: input.signal,
      fetch: this.fetch,
      failedResponseHandler: createImageTransportErrorResponseHandler(),
      successfulResponseHandler: createJsonResponseHandler(ovmsImageResponseSchema)
    })

    const images = response.value.data.map((item) => `data:image/png;base64,${item.b64_json}`)
    return completedImageTransportSubmission(images, 'OVMS')
  }
}

export function createOvmsTransport(settings: OvmsTransportSettings): OvmsTransport {
  return new OvmsTransport(settings)
}

export type { OvmsTransport }
