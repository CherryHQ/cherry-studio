import type { ImageModelV3, ImageModelV3CallOptions } from '@ai-sdk/provider'
import { loggerService } from '@logger'
import type { ImageSizeToken } from '@main/ai/utils/aiSdkNativeBindings'
import type { ImageGenerationMode } from '@shared/data/types/model'

import type { VendorBag, WireVendorBag } from '../../utils/imageOptions'
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

/**
 * `P` is the transport's own `providerParams` spelling — {@link VendorBag} for the job
 * path, {@link WireVendorBag} for the in-SDK path. Declared with PROPERTY syntax, not
 * method syntax: methods are checked bivariantly, so `Transport<VendorBag>` would be
 * assignable to `Transport<WireVendorBag>` and the parameter would be decoration.
 */
export interface ImageGenerationTransport<P = VendorBag | WireVendorBag> {
  submit: (input: ImageGenerationSubmitInput<P>) => Promise<{ taskId?: string; imageUrls?: string[] }>
  /**
   * Declares what {@link submit} will read off this input. Callers warn when the
   * request carries an input the transport drops. Must stay in lockstep with the body
   * builders — `transportInputSupport.test.ts` drives a file/mask-bearing request
   * through `submit()` for every declared model and fails if the two disagree.
   */
  supportsInput?: (input: ImageGenerationSubmitInput<P>) => ImageTransportInputSupport
  /**
   * `modelDescriptor` is carried so a restart-resumed poll on a fresh transport
   * instance can rebuild per-task state (e.g. DashScope's response family).
   */
  poll?: (
    taskId: string,
    options: {
      signal?: AbortSignal
      onProgress?: (progress: number) => void
      modelDescriptor?: ImageTransportDescriptor
    }
  ) => Promise<string[]>
  cancel?: (taskId: string) => Promise<void>
}

/** Provider-agnostic submit payload derived from the AI SDK call options. */
export interface ImageGenerationSubmitInput<P = VendorBag | WireVendorBag> {
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
   * The provider-specific options bag. Its SPELLING depends on which delivery adapter
   * produced it, so the transport declares which one it reads via `P`:
   *
   * - **job path** ({@link VendorBag}) — the canonical camelCase bag straight from
   *   `splitParamValues`; values already validated by `imageParamsSchema` at the IPC
   *   boundary.
   * - **in-SDK path** ({@link WireVendorBag}) — `options.providerOptions[provider]`,
   *   the wire-named body the WireProfile engine built (`num_inference_steps`).
   *
   * See `docs/references/ai/image-generation-parameters.md` on the two adapters.
   */
  providerParams: P
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

      if (abortSignal?.aborted) {
        throw createAbortError('Image generation aborted')
      }

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
          urls = await transport.poll(submitResult.taskId, { signal: abortSignal })
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
