import { createJsonResponseHandler, type FetchFunction, postJsonToApi } from '@ai-sdk/provider-utils'
import type { VendorBag } from '@main/ai/utils/imageOptions'
import * as z from 'zod'

import {
  completedImageTransportSubmission,
  type ImageGenerationSubmitInput,
  type ImageTransportInputSupport,
  type ImmediateImageGenerationTransport
} from '../imageTransport'
import { combineImageTransportHeaders, createImageTransportErrorResponseHandler } from '../imageTransportHttp'
import { fileToDataUrl } from '../transportUtils'

export interface SiliconTransportSettings {
  url: (options: { modelId: string; path: string }) => string
  headers: () => Record<string, string | undefined>
  fetch?: FetchFunction
}

/** Per-call limits of the SiliconFlow image protocol; the SDK splits larger output requests. */
export function siliconImageLimits(modelId: string) {
  return { outputs: modelId === 'Kwai-Kolors/Kolors' ? 4 : 1, inputs: modelId === 'Qwen/Qwen-Image-Edit-2509' ? 3 : 1 }
}

const siliconImageResponseSchema = z
  .object({
    images: z.array(z.object({ url: z.string().min(1) }).passthrough()).min(1)
  })
  .passthrough()

class SiliconTransport implements ImmediateImageGenerationTransport<VendorBag> {
  readonly task = { kind: 'unsupported' as const }

  constructor(private readonly settings: SiliconTransportSettings) {}

  supportsInput(): ImageTransportInputSupport {
    return { files: true, mask: false }
  }

  async submit(input: ImageGenerationSubmitInput<VendorBag>) {
    const limits = siliconImageLimits(input.modelId)
    if ((input.files?.length ?? 0) > limits.inputs)
      throw new Error(`SiliconFlow accepts at most ${limits.inputs} input images for ${input.modelId}`)
    if (input.n > limits.outputs)
      throw new Error(`SiliconFlow accepts at most ${limits.outputs} output images per call for ${input.modelId}`)
    const bag = input.providerParams
    const body: Record<string, unknown> = {
      model: input.modelId,
      prompt: input.prompt ?? ''
    }
    if (input.size) body.image_size = input.size
    if (input.n > 1) body.batch_size = input.n
    if (input.seed !== undefined) body.seed = input.seed

    if (bag.negativePrompt !== undefined) body.negative_prompt = bag.negativePrompt
    if (bag.numInferenceSteps !== undefined) body.num_inference_steps = bag.numInferenceSteps
    if (bag.guidanceScale !== undefined) body.guidance_scale = bag.guidanceScale
    if (bag.cfg !== undefined) body.cfg = bag.cfg
    if (bag.promptEnhancement !== undefined) body.prompt_enhancement = bag.promptEnhancement

    const slots = ['image', 'image2', 'image3'] as const
    for (let index = 0; index < (input.files?.length ?? 0); index++) {
      const file = input.files?.[index]
      if (file) body[slots[index]] = fileToDataUrl(file)
    }

    const url = this.settings.url({ path: '/images/generations', modelId: input.modelId })
    const response = await postJsonToApi({
      url,
      headers: combineImageTransportHeaders(this.settings.headers(), input.headers),
      body,
      abortSignal: input.signal,
      fetch: this.settings.fetch,
      failedResponseHandler: createImageTransportErrorResponseHandler(),
      successfulResponseHandler: createJsonResponseHandler(siliconImageResponseSchema)
    })
    const images = response.value.images.map((item) => item.url)
    return completedImageTransportSubmission(images, 'SiliconFlow')
  }
}

export function createSiliconTransport(settings: SiliconTransportSettings): SiliconTransport {
  return new SiliconTransport(settings)
}

export type { SiliconTransport }
