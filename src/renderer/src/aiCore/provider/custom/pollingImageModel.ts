import type { ImageModelV3, ImageModelV3CallOptions } from '@ai-sdk/provider'

/**
 * Generic submit→poll strategy for async image-generation providers.
 *
 * `submit` either returns image URLs directly (synchronous providers that
 * respond with the finished images) or a `taskId` for asynchronous providers
 * that must be polled. `poll` resolves to image URLs and must honor the
 * `AbortSignal` and report 0-100 integer progress via `onProgress`.
 */
export interface PollingTransport {
  submit(input: PollingSubmitInput): Promise<{ taskId?: string; imageUrls?: string[] }>
  poll(taskId: string, options: { signal?: AbortSignal; onProgress?: (progress: number) => void }): Promise<string[]>
}

/**
 * Provider-agnostic submit payload derived from the AI SDK call options.
 *
 * `providerParams` carries the provider-specific options bag
 * (`options.providerOptions[provider]`) by reference, so a non-JSON
 * `onProgress` callback nested in it survives to the transport.
 */
export interface PollingSubmitInput {
  prompt: string | undefined
  n: number
  size: `${number}x${number}` | undefined
  seed: number | undefined
  files: ImageModelV3CallOptions['files']
  mask: ImageModelV3CallOptions['mask']
  providerParams: Record<string, unknown>
  /**
   * Abort signal forwarded from `options.abortSignal`. Polling providers
   * (ppio/tokenflux) ignore it (they abort during `poll()`); single-shot
   * providers (dmxapi/ovms) use it to make their one `submit()` fetch
   * cancellable, since `poll()` is never reached.
   */
  signal?: AbortSignal
}

export interface CreatePollingImageModelOptions {
  provider: string
  transport: PollingTransport
}

function createAbortError(message: string): Error {
  const error = new Error(message)
  error.name = 'AbortError'
  return error
}

/**
 * Builds an `ImageModelV3` whose `doGenerate` runs submit→poll→return-urls,
 * parameterized by an injected `PollingTransport`. It returns image **URLs**;
 * the patched `ai` SDK auto-downloads them (default download function) into a
 * `GeneratedFile` so no AiProvider/convertImageResult change is needed.
 *
 * Progress is surfaced through `options.providerOptions[provider].onProgress`
 * (typed loosely / cast — the function survives by reference through the
 * plugin chain). Abort is propagated via `options.abortSignal`.
 */
export function createPollingImageModel(
  modelId: string,
  { provider, transport }: CreatePollingImageModelOptions
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

      const providerParams = ((options.providerOptions?.[provider] as Record<string, unknown> | undefined) ??
        {}) as Record<string, unknown>

      const onProgress =
        typeof providerParams.onProgress === 'function'
          ? (providerParams.onProgress as (progress: number) => void)
          : undefined

      const submitResult = await transport.submit({
        prompt: options.prompt,
        n: options.n,
        size: options.size,
        seed: options.seed,
        files: options.files,
        mask: options.mask,
        providerParams,
        signal: abortSignal
      })

      let urls: string[]
      if (submitResult.imageUrls) {
        urls = submitResult.imageUrls
      } else if (submitResult.taskId) {
        urls = await transport.poll(submitResult.taskId, { signal: abortSignal, onProgress })
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
