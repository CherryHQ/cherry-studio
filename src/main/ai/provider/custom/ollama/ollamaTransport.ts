import { createJsonResponseHandler, type FetchFunction, postJsonToApi } from '@ai-sdk/provider-utils'
import * as z from 'zod'

import type { VendorBag } from '@main/ai/utils/imageOptions'

import type { ImageGenerationSubmitInput } from '../imageTransport'
import {
  completedImageTransportSubmission,
  type ImageTransportInputSupport,
  type ImmediateImageGenerationTransport
} from '../imageTransport'
import { combineImageTransportHeaders, createImageTransportErrorResponseHandler } from '../imageTransportHttp'

/** Single-shot Ollama image protocol: top-level dimensions/steps and nested options.seed. */
const ollamaImageResponseSchema = z.object({ image: z.string().min(1) }).passthrough()

export interface OllamaTransportSettings {
  /** Already carries the `/api` suffix, matching `ollama-ai-provider-v2`'s own baseURL convention. */
  baseURL: string
  headers?: Record<string, string>
  fetch: FetchFunction
}

class OllamaTransport implements ImmediateImageGenerationTransport<VendorBag> {
  private readonly baseURL: string
  private readonly headers: Record<string, string>
  private readonly fetch: FetchFunction

  readonly task = { kind: 'unsupported' as const }

  constructor(settings: OllamaTransportSettings) {
    this.baseURL = settings.baseURL
    this.headers = settings.headers ?? {}
    this.fetch = settings.fetch
  }

  /** `/api/generate` takes a prompt only — Ollama's image models are text-to-image. */
  supportsInput(): ImageTransportInputSupport {
    return { files: false, mask: false }
  }

  async submit(input: ImageGenerationSubmitInput<VendorBag>) {
    const [width, height] = input.size?.split('x').map(Number) ?? []
    const steps = input.providerParams.numInferenceSteps
    const response = await postJsonToApi({
      url: `${this.baseURL}/generate`,
      headers: combineImageTransportHeaders(this.headers, input.headers),
      body: {
        model: input.modelId,
        prompt: input.prompt ?? '',
        stream: false,
        ...(width !== undefined && height !== undefined && { width, height }),
        ...(typeof steps === 'number' && { steps }),
        ...(input.seed !== undefined && { options: { seed: input.seed } })
      },
      abortSignal: input.signal,
      fetch: this.fetch,
      failedResponseHandler: createImageTransportErrorResponseHandler(),
      successfulResponseHandler: createJsonResponseHandler(ollamaImageResponseSchema)
    })
    // The SDK accepts bare base64 results directly; the vendor already encoded these bytes.
    return completedImageTransportSubmission([response.value.image], 'Ollama')
  }
}

export function createOllamaTransport(settings: OllamaTransportSettings): OllamaTransport {
  return new OllamaTransport(settings)
}

export type { OllamaTransport }
