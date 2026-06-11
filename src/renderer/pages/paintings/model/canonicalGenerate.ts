import type { FileMetadata, GenerateImageParams } from '@renderer/types'
import { createPaintingGenerateError } from '@shared/ai/paintingGenerateError'
import type { CanonicalParamKey } from '@shared/data/types/model'

import { checkProviderEnabled } from '../utils/checkProviderEnabled'
import { generatePainting } from './generatePainting'
import type { GenerateInput } from './types/generateInput'
import type { PaintingData } from './types/paintingData'

type AiSdkParams = Omit<GenerateImageParams, 'model' | 'prompt' | 'signal' | 'providerOptions'>

/** Encode raw image bytes as a `data:` URL for the main-process image IPC. */
function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return `data:${mime || 'image/png'};base64,${btoa(binary)}`
}

/**
 * Painting-state keys (registry-canonical) that map to a different AI SDK
 * canonical param name. The only divergence today: `size → imageSize` (UI
 * canonical vs AI SDK canonical) and `numImages → batchSize`. Everything
 * else matches name-for-name.
 */
const POSITIONAL_RENAME: Partial<Record<CanonicalParamKey, string>> = {
  size: 'imageSize',
  numImages: 'batchSize'
}

/**
 * AI SDK canonical fields recognized by `generatePainting` / the AI SDK
 * image-model. Anything outside this set, after `POSITIONAL_RENAME`, flows
 * through `providerOptions[providerId]` (the vendor bag) — the AI SDK
 * image-model adapter for that vendor reads it.
 *
 * Adding a new AI SDK canonical field: append it here. Renderer / registry
 * agree on the canonical name; the vendor adapter takes care of any
 * wire-format quirks (snake_case rename, enum string format, etc.).
 */
const AI_SDK_NATIVE_KEYS = new Set([
  'imageSize',
  'batchSize',
  'negativePrompt',
  'aspectRatio',
  'allowAutoSize',
  'seed',
  'numInferenceSteps',
  'guidanceScale',
  'promptEnhancement',
  'personGeneration',
  'quality',
  'background',
  'moderation',
  'style',
  'inputImages'
])

export interface CanonicalGenerateOptions<T extends PaintingData> {
  /**
   * Throw a vendor-specific validation error before the generate call
   * fires. Use for cross-field rules that can't fit a single resolver.
   */
  preValidate?: (painting: T) => void
  /**
   * Constants always written into `aiSdkParams`, overriding any
   * `painting.params` read for the same key. Use for vendor-wide flags
   * (newapi's `allowAutoSize: true`).
   */
  constants?: Partial<AiSdkParams>
  /**
   * Whether `painting.prompt` must be non-empty. Default `true`. Pass
   * `false` (or a predicate returning `false`) for models that accept
   * empty prompts (ppio image-upscaler / image-eraser /
   * image-remove-background). `preValidate` is responsible for any
   * per-model rule when the standard check is skipped.
   */
  requirePrompt?: boolean | ((painting: T) => boolean)
}

/**
 * Generic painting generate path. Reads `painting.params` (keyed by
 * canonical names from the registry's `imageGeneration.modes[mode]
 * .supports`), partitions each entry into `aiSdkParams` vs
 * `providerOptions[providerId]` via `AI_SDK_NATIVE_KEYS` + `POSITIONAL_
 * RENAME`, and hands the result to the shared `generatePainting`
 * skeleton.
 *
 * Vendor wire transforms (snake_case, `ASPECT_X_Y → X:Y`, base64
 * encoding, etc.) live in `aiCore/provider/custom/{aihubmixImageModel,
 * {ppio,dmxapi}/<vendor>Transport.ts`. This function ships canonical names
 * only. The pre-`AI_SDK_PARAM_KEYS` constant + per-vendor `fieldMap` /
 * `keyMap` aliases are gone — `params` keys ARE canonical.
 *
 * Empty / undefined / empty-string `params` entries are omitted from the
 * wire; the server applies its own default. No client-side defaults.
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

  const params = painting.params ?? {}
  const aiSdkParams: Record<string, unknown> = {}
  const providerBag: Record<string, unknown> = {}

  // UI-only companions of the `customSize` widget: it stores the typed
  // width/height under these keys and sets its paired enum (`size`) to
  // 'custom'. They're composed into the wire size below, never sent raw.
  const CUSTOM_SIZE_KEYS = new Set(['customSize_width', 'customSize_height'])

  function place(paramKey: string, value: unknown): void {
    if (value === undefined || value === '' || value === null) return
    const aiKey = (POSITIONAL_RENAME as Record<string, string>)[paramKey] ?? paramKey
    if (AI_SDK_NATIVE_KEYS.has(aiKey)) {
      aiSdkParams[aiKey] = value
    } else {
      providerBag[paramKey] = value
    }
  }

  // 1. Raw painting state — every params entry partitions into one slot.
  for (const [paramKey, value] of Object.entries(params)) {
    if (CUSTOM_SIZE_KEYS.has(paramKey)) continue
    place(paramKey, value)
  }

  // 2. Custom size: the customSize widget pairs `size: 'custom'` with
  //    `customSize_width`/`customSize_height` (zhipu CogView's free WxH
  //    range). Compose them into the AI SDK `imageSize`; drop the sentinel
  //    when width/height are incomplete so the server applies its default.
  if (aiSdkParams.imageSize === 'custom') {
    const width = params.customSize_width
    const height = params.customSize_height
    if (typeof width === 'number' && typeof height === 'number') {
      aiSdkParams.imageSize = `${width}x${height}`
    } else {
      delete aiSdkParams.imageSize
    }
  }

  // 3. Constants are always-on aiSdkParams overrides.
  Object.assign(aiSdkParams, options.constants ?? {})

  // 4. Pre-fetch attached image bytes when the user attached files via the
  // prompt-box surface. The AI SDK image-model adapter for the vendor
  // picks the right endpoint (gpt-image-1's `/v1/images/edits`, Ideogram
  // V_3's FormData branch, etc.) when `inputImages` is non-empty.
  const inputFiles = painting.inputFiles ?? []
  if (inputFiles.length > 0) {
    aiSdkParams.inputImages = await Promise.all(
      inputFiles.map(async (entry) => {
        const onDiskName = `${entry.id}${entry.ext ? `.${entry.ext}` : ''}`
        const { data, mime } = await window.api.file.binaryImage(onDiskName)
        return bytesToDataUrl(new Uint8Array(data), mime)
      })
    )
  }

  return generatePainting({
    provider,
    signal: abortController.signal,
    modelId,
    prompt,
    aiSdkParams: aiSdkParams as AiSdkParams,
    ...(Object.keys(providerBag).length > 0 && { providerBag })
  })
}
