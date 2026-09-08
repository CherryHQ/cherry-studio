import { combineHeaders, createJsonResponseHandler, type FetchFunction, postJsonToApi } from '@ai-sdk/provider-utils'
import type { WireVendorBag } from '@main/ai/utils/imageOptions'
import * as z from 'zod'

import {
  completedImageTransportSubmission,
  type ImageGenerationSubmitInput,
  type ImageTransportInputSupport,
  type ImmediateImageGenerationTransport
} from '../imageTransport'
import { createImageTransportErrorResponseHandler } from '../imageTransportHttp'
import { fileToDataUrl } from '../transportUtils'

export interface SiliconTransportSettings {
  url: (options: { modelId: string; path: string }) => string
  headers: () => Record<string, string | undefined>
  fetch?: FetchFunction
}

const siliconImageResponseSchema = z
  .object({
    images: z
      .array(z.object({ url: z.string().min(1).optional(), b64_json: z.string().min(1).optional() }).passthrough())
      .optional(),
    data: z
      .array(z.object({ url: z.string().min(1).optional(), b64_json: z.string().min(1).optional() }).passthrough())
      .optional()
  })
  .passthrough()

class SiliconTransport implements ImmediateImageGenerationTransport<WireVendorBag> {
  readonly task = { kind: 'unsupported' as const }

  constructor(private readonly settings: SiliconTransportSettings) {}

  supportsInput(): ImageTransportInputSupport {
    return { files: true, mask: false }
  }

  async submit(input: ImageGenerationSubmitInput<WireVendorBag>) {
    const bag = input.providerParams
    const body: Record<string, unknown> = {
      model: input.modelId,
      prompt: input.prompt ?? ''
    }
    if (input.size) body.image_size = input.size
    if (input.n > 1) body.batch_size = input.n
    if (input.seed !== undefined) body.seed = input.seed

    for (const key of [
      'negative_prompt',
      'num_inference_steps',
      'guidance_scale',
      'cfg',
      'prompt_enhancement'
    ] as const) {
      const value = bag[key]
      if (value !== undefined && value !== '' && value !== null) body[key] = value
    }

    const slots = ['image', 'image2', 'image3'] as const
    for (let index = 0; index < Math.min(input.files?.length ?? 0, slots.length); index++) {
      const file = input.files?.[index]
      if (file) body[slots[index]] = fileToDataUrl(file)
    }

    const url = this.settings.url({ path: '/images/generations', modelId: input.modelId })
    const response = await postJsonToApi({
      url,
      headers: combineHeaders(this.settings.headers(), input.headers),
      body,
      abortSignal: input.signal,
      fetch: this.settings.fetch,
      failedResponseHandler: createImageTransportErrorResponseHandler(),
      successfulResponseHandler: createJsonResponseHandler(siliconImageResponseSchema)
    })
    const items = response.value.images ?? response.value.data ?? []
    const images = items
      .map((item) => item.b64_json ?? item.url)
      .filter((image): image is string => image !== undefined)
    return completedImageTransportSubmission(images, 'SiliconFlow')
  }
}

export function createSiliconTransport(settings: SiliconTransportSettings): SiliconTransport {
  return new SiliconTransport(settings)
}

export type { SiliconTransport }
