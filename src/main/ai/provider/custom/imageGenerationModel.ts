import type { ImageModelV3, ImageModelV3CallOptions } from '@ai-sdk/provider'
import { loggerService } from '@logger'

import type { WireVendorBag } from '../../utils/imageOptions'
import type { ImageGenerationSubmitInput, ImageGenerationTransport } from './imageTransport'
import { executeImageTransport } from './imageTransportRuntime'

const logger = loggerService.withContext('imageTransport')

export type {
  ImageGenerationSubmitInput,
  ImageGenerationTransport,
  ImageTransportDescriptor,
  ImageTransportInputSupport
} from './imageTransport'

export interface CreateImageGenerationModelOptions {
  provider: string
  /** In-SDK path: `providerOptions[provider]` is the wire-named body, never canonical. */
  transport: ImageGenerationTransport<WireVendorBag>
}

/**
 * The `imageModel` for a provider whose images ALWAYS take the job transport:
 * `AiService.generateImage` resolves `resolveImageTransport` first and these providers'
 * resolvers return unconditionally, so this is never built (`wireRegistryReachability`
 * asserts the same property). `ProviderV3` requires an `imageModel`, so it says that
 * instead of re-delivering the bag under the in-SDK path's WIRE spelling — which is now
 * a compile error, and which used to surface as `Missing modelDescriptor`.
 */
export function transportOnlyImageModel(provider: string, modelId: string): ImageModelV3 {
  return {
    specificationVersion: 'v3',
    provider,
    modelId,
    maxImagesPerCall: 1,
    async doGenerate() {
      throw new Error(
        `${provider} images are transport-only: reaching the in-SDK image model means the transport gate was bypassed (model '${modelId}')`
      )
    }
  }
}

/**
 * The inputs this request carries that the transport has declared it will not read.
 * Empty when the transport declares nothing (unknown ≠ unsupported) or carries none.
 */
export function unsupportedTransportInputs<P>(
  transport: ImageGenerationTransport<P>,
  input: ImageGenerationSubmitInput<P>
): string[] {
  const support = transport.supportsInput(input)
  const ignored: string[] = []
  if (input.files && input.files.length > 0 && !support.files) ignored.push('files')
  if (input.mask && !support.mask) ignored.push('mask')
  return ignored
}

/**
 * Log the inputs a transport will drop. A dropped reference image is the worst silent
 * failure in the image path: the request succeeds and returns a plausible picture that
 * simply ignored what the user attached, so image-to-image degrades to text-to-image
 * with no error anywhere.
 */
export function warnUnsupportedTransportInputs<P>(
  transport: ImageGenerationTransport<P>,
  input: ImageGenerationSubmitInput<P>,
  context: Record<string, unknown>
): void {
  const ignored = unsupportedTransportInputs(transport, input)
  if (ignored.length === 0) return
  logger.warn('Transport ignores request inputs it has no wire slot for', {
    ...context,
    modelId: input.modelId,
    ignored
  })
}

/**
 * Builds an `ImageModelV3` whose `doGenerate` runs submit→optional-poll→return-urls,
 * parameterized by an injected `ImageGenerationTransport`. It returns image **URLs**;
 * the patched `ai` SDK auto-downloads them (default download function) into a
 * `GeneratedFile` so no AiProvider/convertImageResult change is needed.
 *
 * Abort is propagated via `options.abortSignal`.
 */
export function createImageGenerationModel(
  modelId: string,
  { provider, transport }: CreateImageGenerationModelOptions
): ImageModelV3 {
  return {
    specificationVersion: 'v3',
    provider,
    modelId,
    maxImagesPerCall: 1,
    async doGenerate(options: ImageModelV3CallOptions) {
      const { abortSignal } = options

      // The WireProfile engine's output for this provider — wire-named, JSON-only
      // (`buildImageRequest` drops anything unserializable), so no callback can ride it.
      const providerParams: WireVendorBag = options.providerOptions?.[provider] ?? {}

      const submitInput: ImageGenerationSubmitInput<WireVendorBag> = {
        modelId,
        prompt: options.prompt,
        n: options.n,
        size: options.size,
        aspectRatio: options.aspectRatio,
        seed: options.seed,
        files: options.files,
        mask: options.mask,
        providerParams,
        headers: options.headers,
        signal: abortSignal
      }

      warnUnsupportedTransportInputs(transport, submitInput, { provider })

      const urls = await executeImageTransport({
        transport,
        input: submitInput,
        onTaskSubmitted: async () => {},
        onProgress: () => {},
        logContext: { provider, modelId }
      })

      return {
        images: urls,
        warnings: [],
        response: {
          timestamp: new Date(),
          modelId,
          headers: {}
        }
      }
    }
  }
}
