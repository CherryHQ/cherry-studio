import type { ImageModelV3, ImageModelV3CallOptions } from '@ai-sdk/provider'
import { loggerService } from '@logger'
import type { ImageSizeToken } from '@main/ai/utils/aiSdkNativeBindings'
import type { ImageGenerationMode } from '@shared/data/types/model'

import { createAbortError } from './transportUtils'

const logger = loggerService.withContext('imageTransport')

/**
 * Per-model transport routing — which endpoint to POST, whether to poll, and
 * which response family to parse. Derived in main from the registry's
 * `modes[mode].vendorTransport` (NOT a user param), so it travels on its own
 * typed channel (the job payload / submit input), not the `providerParams` bag.
 */
export interface ImageTransportDescriptor {
  id: string
  endpoint: string
  isSync?: boolean
  mode?: ImageGenerationMode
}

/**
 * Which non-prompt inputs a transport actually puts on the wire for one request.
 *
 * Unlike the SDK path — where the model reports what it refused via `warnings` — a
 * transport hand-writes its own envelope, so only it knows whether a given model's
 * body has a slot for a reference image or a mask. Undeclared, an ignored input is
 * invisible: the request succeeds and returns an image that simply isn't an edit of
 * what the user attached. Per-request rather than per-transport because support is
 * per model — and for PPIO's Seedream family, per `modelDescriptor.mode` too.
 */
export interface ImageTransportInputSupport {
  /** Reads `input.files` — reference images / image-to-image. */
  readonly files: boolean
  /** Reads `input.mask` — inpainting. */
  readonly mask: boolean
}

export interface ImageGenerationTransport {
  submit(input: ImageGenerationSubmitInput): Promise<{ taskId?: string; imageUrls?: string[] }>
  /**
   * Declares what {@link submit} will read off this input. Callers warn when the
   * request carries an input the transport drops. Must stay in lockstep with the body
   * builders — `transportInputSupport.test.ts` drives a file/mask-bearing request
   * through `submit()` for every declared model and fails if the two disagree.
   */
  supportsInput?(input: ImageGenerationSubmitInput): ImageTransportInputSupport
  /**
   * `modelDescriptor` is carried so a restart-resumed poll on a fresh transport
   * instance can rebuild per-task state (e.g. DashScope's response family).
   */
  poll?(
    taskId: string,
    options: {
      signal?: AbortSignal
      onProgress?: (progress: number) => void
      modelDescriptor?: ImageTransportDescriptor
    }
  ): Promise<string[]>
  cancel?(taskId: string): Promise<void>
}

/**
 * Provider-agnostic submit payload derived from the AI SDK call options.
 *
 * `providerParams` carries the provider-specific options bag
 * (`options.providerOptions[provider]`) by reference, so a non-JSON
 * `onProgress` callback nested in it survives to the transport.
 */
export interface ImageGenerationSubmitInput {
  modelId: string
  prompt: string | undefined
  n: number
  /** `WxH` pixels OR a vendor shorthand (`1K`/`2K`/`4K`) — see {@link ImageSizeToken}.
   *  Transports that split on `'x'` must guard; a Seedream `2K` is a legal value here. */
  size: ImageSizeToken | undefined
  /** Normalized `X:Y` aspect ratio (a native AI SDK param, like `size`/`seed`). */
  aspectRatio?: string
  seed: number | undefined
  files: ImageModelV3CallOptions['files']
  mask: ImageModelV3CallOptions['mask']
  /** Per-model routing, derived in main from the registry (not a user param). */
  modelDescriptor?: ImageTransportDescriptor
  /**
   * The provider-specific options bag, by reference (so a non-JSON `onProgress`
   * callback nested in it survives to the transport).
   *
   * `unknown`-valued because its SPELLING depends on which delivery adapter produced
   * it, and one type cannot describe both:
   *
   * - **job path** (`AiService.generateImageViaJob` → ppio / dashscope / modelscope /
   *   dmxapi / tokenhub) — the raw canonical camelCase `vendorBag`. Those transports
   *   narrow it with a `Pick<ParamValues, …>` alias, so the cast is checked against
   *   `IMAGE_PARAM_CATALOG` at the point of use and the values were already validated
   *   by `imageParamsSchema` at the IPC boundary.
   * - **in-SDK path** (`createImageGenerationModel` → ovms / ollama) —
   *   `options.providerOptions[provider]`, i.e. the WIRE-NAMED body the WireProfile
   *   engine produced (`num_inference_steps`, `steps`). Not canonical keys, so those
   *   two read it as loose fields on purpose.
   *
   * Narrowing this field itself would force one spelling onto both. See
   * `docs/references/ai/image-generation-parameters.md` on the two adapters.
   */
  providerParams: Record<string, unknown>
  /**
   * Abort signal forwarded from `options.abortSignal`. Async providers
   * (ppio) ignore it (they abort during `poll()`); single-shot
   * providers (dmxapi/ovms) use it to make their one `submit()` fetch
   * cancellable, since `poll()` is never reached.
   */
  signal?: AbortSignal
}

export interface CreateImageGenerationModelOptions {
  provider: string
  transport: ImageGenerationTransport
}

/**
 * The inputs this request carries that the transport has declared it will not read.
 * Empty when the transport declares nothing (unknown ≠ unsupported) or carries none.
 */
export function unsupportedTransportInputs(
  transport: ImageGenerationTransport,
  input: ImageGenerationSubmitInput
): string[] {
  const support = transport.supportsInput?.(input)
  if (!support) return []
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
export function warnUnsupportedTransportInputs(
  transport: ImageGenerationTransport,
  input: ImageGenerationSubmitInput,
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

      if (abortSignal?.aborted) {
        throw createAbortError('Image generation aborted')
      }

      const providerParams = (options.providerOptions?.[provider] as Record<string, unknown> | undefined) ?? {}

      const onProgress =
        typeof providerParams.onProgress === 'function'
          ? (providerParams.onProgress as (progress: number) => void)
          : undefined

      const submitInput: ImageGenerationSubmitInput = {
        modelId,
        prompt: options.prompt,
        n: options.n,
        size: options.size,
        aspectRatio: options.aspectRatio,
        seed: options.seed,
        files: options.files,
        mask: options.mask,
        providerParams,
        signal: abortSignal
      }

      warnUnsupportedTransportInputs(transport, submitInput, { provider })

      const submitResult = await transport.submit(submitInput)

      let urls: string[]
      if (submitResult.imageUrls) {
        urls = submitResult.imageUrls
      } else if (submitResult.taskId) {
        if (!transport.poll) {
          throw new Error(`${provider} returned a task id but does not implement polling`)
        }

        let cancelRequested = false
        const cancelRemoteTask = () => {
          if (cancelRequested) return
          cancelRequested = true
          void transport.cancel?.(submitResult.taskId as string).catch(() => {})
        }

        if (abortSignal?.aborted) {
          cancelRemoteTask()
          throw createAbortError('Image generation aborted')
        }

        abortSignal?.addEventListener('abort', cancelRemoteTask, { once: true })
        try {
          urls = await transport.poll(submitResult.taskId, { signal: abortSignal, onProgress })
        } finally {
          abortSignal?.removeEventListener('abort', cancelRemoteTask)
        }
      } else {
        urls = []
      }

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
