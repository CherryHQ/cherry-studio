import type { FileMetadata, GenerateImageParams } from '@renderer/types'

import { fileEntryToMetadata } from '../utils/fileEntryAdapter'
import { runPainting } from './runPainting'
import type { PaintingProviderRuntime } from './types/paintingProviderRuntime'

/**
 * Shared painting generate skeleton. Image generation runs in the MAIN process
 * via the `Ai_GenerateImage` IPC (`window.api.ai.generateImage`): main resolves
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
   * `signal` / `providerOptions`). `imageSize` / `batchSize` / `negativePrompt`
   * / `seed` / `aspectRatio` / `inputImages` (already encoded as data URLs) /
   * etc. live here.
   */
  readonly aiSdkParams: Omit<GenerateImageParams, 'model' | 'prompt' | 'signal' | 'providerOptions'>
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

    const seedRaw = typeof aiSdkParams.seed === 'string' ? aiSdkParams.seed.trim() : ''
    const seed = /^-?\d+$/.test(seedRaw) ? Number(seedRaw) : undefined
    // canonicalGenerate encodes attached files as `data:` URL strings.
    const inputImages = (aiSdkParams.inputImages ?? []).filter((img): img is string => typeof img === 'string')

    const requestId = crypto.randomUUID()
    const onAbort = () => window.api.ai.abortImage(requestId)
    opts.signal.addEventListener('abort', onAbort, { once: true })
    const result = await window.api.ai
      .generateImage(
        {
          uniqueModelId: `${opts.provider.id}::${opts.modelId}`,
          prompt: opts.prompt,
          ...(inputImages.length > 0 && { inputImages }),
          ...(aiSdkParams.batchSize !== undefined && { n: aiSdkParams.batchSize }),
          ...(aiSdkParams.imageSize && { size: aiSdkParams.imageSize }),
          ...(aiSdkParams.negativePrompt && { negativePrompt: aiSdkParams.negativePrompt }),
          ...(seed !== undefined && { seed }),
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
        },
        requestId
      )
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
