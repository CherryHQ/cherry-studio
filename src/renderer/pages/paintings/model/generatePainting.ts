import { ipcApi } from '@renderer/ipc'
import type { FileMetadata } from '@renderer/types/file'
import type { GenerateImageParams } from '@shared/types/image'

import { fileEntryToMetadata } from '../utils/fileEntryAdapter'
import { runPainting } from './runPainting'
import type { PaintingProviderRuntime } from './types/paintingProviderRuntime'

/**
 * Shared painting generate skeleton. Image generation runs in the MAIN process
 * via the `ai.generate_image` IpcApi route (`ipcApi.request`): main resolves
 * the provider from `uniqueModelId`, builds the AI SDK image request (including
 * per-vendor `providerOptions` via `buildImageProviderOptions`), runs any async
 * submit/poll loop, and returns base64 data URLs. The renderer only maps the
 * canonical painting params onto the IPC payload and persists the results.
 *
 * Per-vendor variation (request fields, the `providerOptions` bag) is fed in by
 * the caller — there is no per-provider branching here. Validation (model /
 * prompt required, edit-image checks, custom-size rules, etc.) stays in the
 * caller (`canonicalGenerate`).
 */
export interface GeneratePaintingOptions {
  /** Painting provider runtime (id, name, apiHost, isEnabled). */
  readonly provider: PaintingProviderRuntime
  /** Abort signal — usually `input.abortController.signal`. */
  readonly signal: AbortSignal
  /** Model id chosen by the user; assumed non-empty (caller validates). */
  readonly modelId: string
  /** User-entered prompt; pass `''` when the model allows empty prompts. */
  readonly prompt: string
  /**
   * Canonical AI SDK image params (all fields except `model` / `prompt` /
   * `signal` / `providerOptions`). `n` / `size` / `negativePrompt` / `seed` /
   * `aspectRatio` etc. live here. `inputImages` is narrowed to `string[]`: the
   * painting path always encodes attached files as `data:` URLs.
   */
  readonly aiSdkParams: Omit<GenerateImageParams, 'model' | 'prompt' | 'signal' | 'providerOptions' | 'inputImages'> & {
    inputImages?: string[]
  }
  /**
   * Vendor-exclusive params keyed by canonical name — forwarded to main as
   * `providerOptions[<provider.id>]`, where `buildImageProviderOptions` maps
   * them onto the vendor's real image-API field names. Omit when the vendor
   * has no extras (silicon today).
   */
  readonly providerBag?: Record<string, unknown>
}

export function generatePainting(opts: GeneratePaintingOptions): Promise<FileMetadata[]> {
  return runPainting(async () => {
    const { aiSdkParams, providerBag } = opts

    const inputImages = aiSdkParams.inputImages ?? []

    const requestId = crypto.randomUUID()
    const onAbort = () => void ipcApi.request('ai.abort_image', { requestId })
    opts.signal.addEventListener('abort', onAbort, { once: true })
    const result = await ipcApi
      .request('ai.generate_image', {
        requestId,
        payload: {
          uniqueModelId: `${opts.provider.id}::${opts.modelId}`,
          prompt: opts.prompt,
          ...(inputImages.length > 0 && { inputImages }),
          ...(aiSdkParams.n !== undefined && { n: aiSdkParams.n }),
          ...(aiSdkParams.size && { size: aiSdkParams.size }),
          ...(aiSdkParams.negativePrompt && { negativePrompt: aiSdkParams.negativePrompt }),
          ...(aiSdkParams.seed !== undefined && { seed: aiSdkParams.seed }),
          ...(aiSdkParams.quality && { quality: aiSdkParams.quality }),
          ...(aiSdkParams.numInferenceSteps !== undefined && { numInferenceSteps: aiSdkParams.numInferenceSteps }),
          ...(aiSdkParams.guidanceScale !== undefined && { guidanceScale: aiSdkParams.guidanceScale }),
          ...(aiSdkParams.promptEnhancement !== undefined && { promptEnhancement: aiSdkParams.promptEnhancement }),
          ...(aiSdkParams.personGeneration && { personGeneration: aiSdkParams.personGeneration }),
          ...(aiSdkParams.aspectRatio && { aspectRatio: aiSdkParams.aspectRatio }),
          ...(aiSdkParams.background && { background: aiSdkParams.background }),
          ...(aiSdkParams.moderation && { moderation: aiSdkParams.moderation }),
          ...(aiSdkParams.style && { style: aiSdkParams.style }),
          ...(providerBag && { providerOptions: { [opts.provider.id]: providerBag } })
        }
      })
      // A failure now crosses IpcApi as an IpcError (name 'IpcError'), so an abort would
      // no longer satisfy runPainting's `name === 'AbortError'` cancel check. When the
      // user aborted, re-throw a real AbortError to preserve the silent-cancel behaviour.
      .catch((error) => {
        if (opts.signal.aborted) throw new DOMException('Image generation aborted', 'AbortError')
        throw error
      })
      .finally(() => opts.signal.removeEventListener('abort', onAbort))

    if (opts.signal.aborted) {
      throw new DOMException('Image generation aborted', 'AbortError')
    }
    if (result.files.length === 0) {
      return undefined
    }

    // main already persisted the images (`createInternalEntry`); just adapt the
    // returned v2 `FileEntry` rows to the v1 `FileMetadata` the painting state
    // still consumes. No base64 round-trip.
    const files = await Promise.all(result.files.map(fileEntryToMetadata))
    return files.length > 0 ? { files } : undefined
  })
}
