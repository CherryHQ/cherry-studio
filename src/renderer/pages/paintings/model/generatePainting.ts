import type { FileMetadata, GenerateImageParams } from '@renderer/types'
import type { JSONValue } from 'ai'

import type { DownloadImagesOptions } from '../utils/downloadImages'
import { persistGeneratedImages } from '../utils/persistGeneratedImages'
import { runPainting } from './runPainting'
import type { PaintingProviderRuntime } from './types/paintingProviderRuntime'

/**
 * Shared painting generate skeleton — extracted from the 8 per-provider
 * `generate.ts` / `generateUnified.ts` files that all converged on the same
 * shape after the R1 cutover:
 *
 *   1. Map painting form state to the main AI image-generation IPC payload
 *   2. Let main own model/provider resolution and SDK dispatch
 *   3. Persist the returned generated images as internal files
 *
 * Per-vendor variation (request fields, provider-options bag, download
 * options, model lookup) is fed in by the caller — there is no per-provider
 * branching inside this helper. Validation (model required, prompt required,
 * mode-specific edit-image checks, custom-size pixel rules, etc.) stays in
 * each vendor's `generate.ts` because the rules genuinely differ; the goal
 * here is only to consolidate the rote orchestration that did NOT differ.
 */
export interface GeneratePaintingOptions {
  /** Painting provider runtime (id, name, apiHost, isEnabled). */
  readonly provider: PaintingProviderRuntime
  /** Abort signal — usually `input.abortController.signal`. */
  readonly signal: AbortSignal
  /** Resolved API key. Pass `''` for vendors without auth (OVMS). */
  readonly apiKey: string
  /** Model id chosen by the user; assumed non-empty (caller validates). */
  readonly modelId: string
  /** User-entered prompt; pass `''` when the model allows empty prompts. */
  readonly prompt: string
  /**
   * AI-SDK call params (all fields except `model` / `prompt` / `signal` /
   * `providerOptions`, which this helper fills in). `imageSize` /
   * `batchSize` / `negativePrompt` / `seed` / etc. live here.
   */
  readonly aiSdkParams: Omit<GenerateImageParams, 'model' | 'prompt' | 'signal' | 'providerOptions'>
  /**
   * `providerOptions[<provider.id>]` bag — forwarded through the IPC payload.
   * Keep it serializable; main owns SDK dispatch.
   */
  readonly providerBag?: Record<string, unknown>
  /**
   * Stamped on the `{ urls }` return branch. Use `{ showProxyWarning: true }`
   * for proxied CDN URLs (Ideogram), `{ allowBase64DataUrls: true }` for
   * mixed url+data: responses (DMXAPI). Default: no options.
   */
  readonly downloadOptions?: DownloadImagesOptions
}

export function generatePainting(opts: GeneratePaintingOptions): Promise<FileMetadata[]> {
  return runPainting(async () => {
    const providerOptions = opts.providerBag
      ? ({ [opts.provider.id]: opts.providerBag } as Record<string, Record<string, JSONValue>>)
      : undefined
    const seed =
      typeof opts.aiSdkParams.seed === 'string'
        ? Number(opts.aiSdkParams.seed)
        : (opts.aiSdkParams.seed as number | undefined)

    const result = await window.api.ai.generateImage(
      {
        uniqueModelId: `${opts.provider.id}::${opts.modelId}`,
        inputImages: opts.aiSdkParams.inputImages as Uint8Array[] | string[] | undefined,
        n: opts.aiSdkParams.batchSize,
        size: opts.aiSdkParams.imageSize,
        negativePrompt: opts.aiSdkParams.negativePrompt,
        seed: Number.isFinite(seed) ? seed : undefined,
        quality: opts.aiSdkParams.quality,
        numInferenceSteps: opts.aiSdkParams.numInferenceSteps,
        guidanceScale: opts.aiSdkParams.guidanceScale,
        promptEnhancement: opts.aiSdkParams.promptEnhancement,
        personGeneration: opts.aiSdkParams.personGeneration,
        aspectRatio: opts.aiSdkParams.aspectRatio,
        allowAutoSize: opts.aiSdkParams.allowAutoSize,
        background: opts.aiSdkParams.background,
        moderation: opts.aiSdkParams.moderation,
        style: opts.aiSdkParams.style,
        ...(providerOptions && { providerOptions }),
        prompt: opts.prompt
      },
      opts.signal
    )

    return persistGeneratedImages(result.images)
  })
}
