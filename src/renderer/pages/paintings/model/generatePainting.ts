import { AiProvider } from '@renderer/aiCore'
import { getProviderById } from '@renderer/services/ProviderService'
import type { FileMetadata, GenerateImageParams, Model, Provider } from '@renderer/types'

import type { DownloadImagesOptions } from '../utils/downloadImages'
import { runPainting } from './runPainting'
import type { PaintingProviderRuntime } from './types/paintingProviderRuntime'

/**
 * Shared painting generate skeleton — extracted from the 8 per-provider
 * `generate.ts` / `generateUnified.ts` files that all converged on the same
 * shape after the R1 cutover:
 *
 *   1. Build an `AiProvider` for the resolved (provider, modelId)
 *   2. Call `generatePaintingImage(...)` with provider-specific params
 *   3. Classify the returned `ClassifiedImage[]` into `{ urls, ... }` or
 *      `{ base64s }` and hand off to `resolvePaintingFiles`
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
   * `providerOptions[<provider.id>]` bag — forwarded by reference, so
   * non-JSON callbacks (e.g. polling `onProgress`, async-submit
   * `onSubmitTaskId`) survive the plugin chain. Omit when the vendor has no
   * extras (silicon today).
   */
  readonly providerBag?: Record<string, unknown>
  /**
   * Stamped on the `{ urls }` return branch. Use `{ showProxyWarning: true }`
   * for proxied CDN URLs (Ideogram), `{ allowBase64DataUrls: true }` for
   * mixed url+data: responses (DMXAPI). Default: no options.
   */
  readonly downloadOptions?: DownloadImagesOptions
  /**
   * Override the synthesized `Model` placeholder when the caller already has
   * a richer `Model` shape on hand. Most callers omit this and rely on the
   * synthesized placeholder, which only needs `id` / `provider` / `name`.
   */
  readonly model?: Model
}

export function generatePainting(opts: GeneratePaintingOptions): Promise<FileMetadata[]> {
  return runPainting(async () => {
    const model: Model = opts.model ?? {
      id: opts.modelId,
      provider: opts.provider.id,
      name: opts.modelId,
      group: ''
    }

    // Use the real store-side provider so AiProvider picks the right SDK
    // builder (gemini → @ai-sdk/google, anthropic → @ai-sdk/anthropic, etc.)
    // instead of forcing every painting call through the openai-compat path.
    // Painting-resolved apiKey / apiHost / enabled override the store values.
    const storeProvider = getProviderById(opts.provider.id)
    const provider: Provider = storeProvider
      ? {
          ...storeProvider,
          apiKey: opts.apiKey,
          apiHost: opts.provider.apiHost,
          enabled: opts.provider.isEnabled
        }
      : {
          id: opts.provider.id,
          type: 'openai',
          name: opts.provider.name,
          apiKey: opts.apiKey,
          apiHost: opts.provider.apiHost,
          models: [model],
          enabled: opts.provider.isEnabled
        }

    const ai = new AiProvider(model, provider)

    const providerOptions = opts.providerBag ? { [opts.provider.id]: opts.providerBag } : undefined

    const out = await ai.generatePaintingImage({
      ...opts.aiSdkParams,
      model: opts.modelId,
      prompt: opts.prompt,
      ...(providerOptions && { providerOptions }),
      signal: opts.signal
    })

    const urls = out.flatMap((o) => (o.type === 'url' ? [o.url] : []))
    if (urls.length > 0) {
      return opts.downloadOptions ? { urls, downloadOptions: opts.downloadOptions } : { urls }
    }
    const base64s = out.flatMap((o) => (o.type === 'base64' ? [o.base64] : []))
    if (base64s.length > 0) {
      return { base64s }
    }
    return undefined
  })
}
