import { buildParamsSchema } from '@cherrystudio/provider-registry'
import type { FileMetadata } from '@renderer/types/file'
import { createPaintingGenerateError } from '@shared/ai/paintingGenerateError'
import type { ImageGenerationMode, ImageGenerationSupport } from '@shared/data/types/model'

import { checkProviderEnabled } from '../utils/checkProviderEnabled'
import { generatePainting } from './generatePainting'
import type { GenerateInput } from './types/generateInput'
import type { PaintingData } from './types/paintingData'

/** Encode raw image bytes as a `data:` URL for the main-process image IPC. */
function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return `data:${mime || 'image/png'};base64,${btoa(binary)}`
}

export interface CanonicalGenerateOptions<T extends PaintingData> {
  /**
   * Throw a vendor-specific validation error before the generate call
   * fires. Use for cross-field rules that can't fit a single resolver.
   */
  preValidate?: (painting: T) => void
  /**
   * Whether `painting.prompt` must be non-empty. Default `true`. Pass
   * `false` (or a predicate returning `false`) for models that accept
   * empty prompts (ppio image-upscaler / image-eraser /
   * image-remove-background). `preValidate` is responsible for any
   * per-model rule when the standard check is skipped.
   */
  requirePrompt?: boolean | ((painting: T) => boolean)
  /**
   * Registry image-generation support for this model — composes with the
   * central param catalog to validate/coerce `painting.params` (seed
   * string→number, blank→undefined, enum/range bounds) at submit. Threaded in
   * by `paintingPipeline`, which already prefetches it.
   */
  support?: ImageGenerationSupport
  /** Resolved mode for the `support` lookup. Default `'generate'`. */
  mode?: ImageGenerationMode
}

/**
 * Generic painting generate path. Validates/coerces `painting.params` (keyed by
 * canonical names from the registry's `imageGeneration.modes[mode].supports`)
 * via the central catalog (`buildParamsSchema`), then ships the whole canonical
 * bag as `paramValues` to the shared `generatePainting` skeleton. main owns the
 * native-vs-vendor partition (`splitParamValues`) and the per-vendor wire
 * mapping — the renderer stays vendor-agnostic.
 *
 * Empty / undefined / empty-string entries are dropped here (and again in main)
 * so the server applies its own default; no client-side defaults.
 */
export async function canonicalGenerate<T extends PaintingData>(
  input: GenerateInput<T>,
  options: CanonicalGenerateOptions<T> = {}
): Promise<FileMetadata[]> {
  const { painting, provider, abortController } = input

  // Vendor-specific cross-field errors first so they take precedence over
  // the generic MISSING_REQUIRED_FIELDS / PROMPT_REQUIRED throws below.
  options.preValidate?.(painting)

  await checkProviderEnabled(provider)
  const modelId = painting.model
  if (!modelId) throw createPaintingGenerateError('MISSING_REQUIRED_FIELDS')

  const prompt = (painting.prompt ?? '').trim()
  const promptRequired =
    typeof options.requirePrompt === 'function' ? options.requirePrompt(painting) : (options.requirePrompt ?? true)
  if (promptRequired && !prompt) throw createPaintingGenerateError('PROMPT_REQUIRED')

  // 1. Validate / coerce raw form params through the central catalog. Soft-fail:
  //    a bad / legacy value must never break submit, so fall back to raw params.
  const rawParams = painting.params ?? {}
  const validated = buildParamsSchema(options.support, options.mode).safeParse(rawParams)
  const source: Record<string, unknown> = validated.success ? validated.data : rawParams

  // 2. Build the canonical `paramValues` bag: drop blanks (mirrors main's
  //    `splitParamValues` guard — the byte-identical-wire invariant) and the
  //    UI-only `customSize_width`/`customSize_height` companions.
  const paramValues: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(source)) {
    if (key === 'customSize_width' || key === 'customSize_height') continue
    if (value === undefined || value === '' || value === null) continue
    paramValues[key] = value
  }

  // 3. Custom size: the customSize widget pairs `size: 'custom'` with
  //    `customSize_width`/`customSize_height` (zhipu CogView's free WxH range).
  //    Compose them into `size`; drop the sentinel when the pair is incomplete
  //    so the server applies its default.
  if (paramValues.size === 'custom') {
    const width = source.customSize_width
    const height = source.customSize_height
    if (typeof width === 'number' && typeof height === 'number') {
      paramValues.size = `${width}x${height}`
    } else {
      delete paramValues.size
    }
  }

  // 4. Pre-fetch attached image bytes (encoded as `data:` URLs for the IPC),
  //    carried separately from `paramValues` — they're encoded files, not form
  //    params. The vendor image-model adapter picks the right edit endpoint.
  const inputFiles = painting.inputFiles ?? []
  const inputImages =
    inputFiles.length > 0
      ? await Promise.all(
          inputFiles.map(async (entry) => {
            const onDiskName = `${entry.id}${entry.ext ? `.${entry.ext}` : ''}`
            const { data, mime } = await window.api.file.binaryImage(onDiskName)
            return bytesToDataUrl(new Uint8Array(data), mime)
          })
        )
      : undefined

  return generatePainting({
    provider,
    signal: abortController.signal,
    modelId,
    prompt,
    paramValues,
    ...(inputImages && { inputImages })
  })
}
