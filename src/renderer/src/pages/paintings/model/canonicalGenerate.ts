import { createPaintingGenerateError } from '@renderer/aiCore/errors/paintingGenerateError'
import type { FileMetadata, GenerateImageParams } from '@renderer/types'

import type { GenerateInput } from '../providers/types'
import { checkProviderEnabled } from '../utils/checkProviderEnabled'
import type { DownloadImagesOptions } from '../utils/downloadImages'
import { generatePainting } from './generatePainting'
import type { PaintingData } from './types/paintingData'

/**
 * AI-SDK canonical aiSdkParams field set used by `generatePainting`.
 * Tied to `GenerateImageParams` (`src/renderer/src/types/index.ts:582`) minus
 * the orchestration fields the skeleton fills in (`model` / `prompt` /
 * `signal` / `providerOptions`).
 */
type AiSdkParamKey =
  | 'negativePrompt'
  | 'imageSize'
  | 'batchSize'
  | 'allowAutoSize'
  | 'seed'
  | 'numInferenceSteps'
  | 'guidanceScale'
  | 'promptEnhancement'
  | 'personGeneration'
  | 'quality'
  | 'background'
  | 'moderation'

type AiSdkParams = Omit<GenerateImageParams, 'model' | 'prompt' | 'signal' | 'providerOptions'>

export interface CanonicalGenerateOptions<T extends PaintingData> {
  /**
   * AI-SDK field name → PaintingData field name. Omitted keys default to
   * identity (e.g. silicon's `negativePrompt` lives on both sides as
   * `negativePrompt` — no entry needed). Used to bridge legacy persistence
   * field names (silicon: `imageSize`/`steps`, ovms: `num_inference_steps`,
   * etc.) without renaming the DB schema.
   */
  fieldMap?: Partial<Record<AiSdkParamKey, keyof T & string>>
  /**
   * Per-field default applied when the PaintingData value is falsy
   * (undefined / null / empty string). Lets a vendor preserve its bespoke
   * fallback (`steps ?? 25`, `guidanceScale ?? 4.5`) without writing a full
   * generate.ts. Omitted fields are skipped — the server picks its own
   * default — which is the right behavior for fields whose default truly
   * depends on the upstream model.
   */
  defaults?: Partial<AiSdkParams>
  /**
   * Constants always written into aiSdkParams regardless of painting state
   * (e.g. newapi's `allowAutoSize: true`). Overrides any field-map lookup
   * for the same key.
   */
  constants?: Partial<AiSdkParams>
  /**
   * Per-field resolver. Wins over fieldMap/defaults/constants for the
   * declared keys. Returning `undefined` omits the field. Use this for
   * vendor-specific transforms (zhipu's `resolveZhipuImageSize` enforcing
   * CogView's range/divisible-by-16/pixel-budget rules).
   */
  resolvers?: Partial<{ [K in AiSdkParamKey]: (painting: T) => AiSdkParams[K] | undefined }>
  /**
   * Hook to throw a vendor-specific validation error before the generate
   * call fires. Use for cross-field rules that can't fit a single resolver
   * (`createPaintingGenerateError('CUSTOM_SIZE_PIXELS')` etc.).
   */
  preValidate?: (painting: T) => void
  /**
   * Build the `providerBag` (forwarded as `providerOptions[<provider.id>]`).
   * For vendor extras that don't fit the canonical AI-SDK fields (ovms's
   * `num_inference_steps`/`rng_seed` snake-case mirror, ppio's per-model
   * extras, etc.). Return `undefined` to omit.
   */
  providerBag?: (painting: T) => Record<string, unknown> | undefined
  /**
   * Stamped on the `{ urls }` download branch — proxy warning toggle,
   * mixed-url+data acceptance, etc. Matches `generatePainting`'s
   * `downloadOptions` field.
   */
  downloadOptions?: DownloadImagesOptions
  /**
   * Skip `checkProviderEnabled` and pass an empty `apiKey`. For vendors
   * that run without auth (OVMS, local OpenVINO Model Server). The
   * `isEnabled` and `getApiKey()` modal flow is bypassed.
   */
  noAuth?: boolean
  /**
   * Whether `painting.prompt` must be non-empty. Default `true` (matches
   * the standard `PROMPT_REQUIRED` throw). Pass `false` (or a callback
   * returning `false`) for providers whose specific models accept empty
   * prompts (ppio image-upscaler / image-remove-background / image-eraser).
   * When the predicate skips the standard check, `preValidate` is expected
   * to enforce any per-model rule.
   */
  requirePrompt?: boolean | ((painting: T) => boolean)
}

const AI_SDK_PARAM_KEYS: readonly AiSdkParamKey[] = [
  'negativePrompt',
  'imageSize',
  'batchSize',
  'allowAutoSize',
  'seed',
  'numInferenceSteps',
  'guidanceScale',
  'promptEnhancement',
  'personGeneration',
  'quality',
  'background',
  'moderation'
] as const

function isEmptyValue(value: unknown): boolean {
  return value === undefined || value === null || value === ''
}

/**
 * Generic painting generate path: maps a vendor's `PaintingData` (whatever
 * field names it persists) into the canonical AI-SDK `aiSdkParams` shape via
 * an optional `fieldMap` + `defaults` + `resolvers` declaration, then defers
 * the actual call to the shared `generatePainting` skeleton.
 *
 * Replaces the 25-line "map painting.X → aiSdkParams.Y, fall back to default"
 * boilerplate that every vendor used to ship as its own `generate.ts`. The
 * vendor folder collapses to a single table entry (`generate: (input) =>
 * canonicalGenerate(input, { fieldMap, defaults, ... })`) plus, where they
 * exist, named modules for the bits that don't fit the canonical shape
 * (resolvers for vendor-specific size rules, providerBag for vendor extras,
 * preValidate for cross-field rules).
 */
export async function canonicalGenerate<T extends PaintingData>(
  input: GenerateInput<T>,
  options: CanonicalGenerateOptions<T> = {}
): Promise<FileMetadata[]> {
  const { painting, provider, abortController } = input

  // preValidate runs FIRST so vendor-specific error codes take precedence
  // over the generic `MISSING_REQUIRED_FIELDS`/`PROMPT_REQUIRED` messages
  // (e.g. dmxapi's `TEXT_DESC_REQUIRED` / `IMAGE_HANDLE_REQUIRED`).
  options.preValidate?.(painting)

  const apiKey = options.noAuth ? '' : await checkProviderEnabled(provider)
  const modelId = painting.model
  if (!modelId) throw createPaintingGenerateError('MISSING_REQUIRED_FIELDS')
  const prompt = (painting.prompt ?? '').trim()
  const promptRequired =
    typeof options.requirePrompt === 'function' ? options.requirePrompt(painting) : (options.requirePrompt ?? true)
  if (promptRequired && !prompt) throw createPaintingGenerateError('PROMPT_REQUIRED')

  const aiSdkParams: Record<string, unknown> = {}

  for (const aiKey of AI_SDK_PARAM_KEYS) {
    const resolver = options.resolvers?.[aiKey] as ((painting: T) => unknown) | undefined
    if (resolver) {
      const resolved = resolver(painting)
      if (resolved !== undefined) {
        aiSdkParams[aiKey] = resolved
      }
      continue
    }

    const paintingKey = (options.fieldMap?.[aiKey] ?? aiKey) as keyof T
    const raw = (painting as unknown as Record<string, unknown>)[paintingKey as string]
    if (!isEmptyValue(raw)) {
      aiSdkParams[aiKey] = raw
      continue
    }

    const fallback = (options.defaults as Record<string, unknown> | undefined)?.[aiKey]
    if (fallback !== undefined) {
      aiSdkParams[aiKey] = fallback
    }
  }

  // Constants override any field-map / default already written above. This
  // matches the spirit of "vendor always wants X" (newapi's allowAutoSize).
  Object.assign(aiSdkParams, options.constants ?? {})

  const providerBag = options.providerBag?.(painting)

  return generatePainting({
    provider,
    signal: abortController.signal,
    apiKey,
    modelId,
    prompt,
    aiSdkParams: aiSdkParams as AiSdkParams,
    ...(providerBag !== undefined && { providerBag }),
    ...(options.downloadOptions !== undefined && { downloadOptions: options.downloadOptions })
  })
}
