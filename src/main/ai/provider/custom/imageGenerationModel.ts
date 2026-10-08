import type { ImageModelV3, ImageModelV3CallOptions } from '@ai-sdk/provider'

import { loggerService } from '@logger'

import { parseImageVendorParams, type VendorBag } from '../../utils/imageOptions'
import type { ImageGenerationSubmitInput, ImageGenerationTransport, ImageTransportDescriptor } from './imageTransport'
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
  transport: ImageGenerationTransport<VendorBag>
  modelDescriptor: ImageTransportDescriptor | undefined
}

/** Inputs this request carries that the selected protocol does not support. */
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

/** Warn when a protocol cannot consume a reference or mask, even if generation can succeed. */
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
  { provider, transport, modelDescriptor }: CreateImageGenerationModelOptions
): ImageModelV3 {
  return {
    specificationVersion: 'v3',
    provider,
    modelId,
    maxImagesPerCall: 1,
    async doGenerate(options: ImageModelV3CallOptions) {
      const { abortSignal } = options

      const providerParams = parseImageVendorParams(options.providerOptions[provider] ?? {})

      const submitInput: ImageGenerationSubmitInput<VendorBag> = {
        modelId,
        prompt: options.prompt,
        n: options.n,
        size: options.size,
        aspectRatio: options.aspectRatio,
        seed: options.seed,
        files: options.files,
        mask: options.mask,
        modelDescriptor,
        providerParams,
        headers: options.headers,
        signal: abortSignal
      }

      const warnings = unsupportedTransportInputs(transport, submitInput).map((feature) => ({
        type: 'unsupported' as const,
        feature
      }))

      const urls = await executeImageTransport({
        transport,
        input: submitInput,
        onTaskSubmitted: async () => {},
        onProgress: () => {},
        logContext: { provider, modelId }
      })

      return {
        images: urls,
        warnings,
        response: {
          timestamp: new Date(),
          modelId,
          headers: {}
        }
      }
    }
  }
}
