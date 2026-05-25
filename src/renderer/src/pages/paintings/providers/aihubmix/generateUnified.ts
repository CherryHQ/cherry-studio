import { createPaintingGenerateError } from '@renderer/aiCore/errors/paintingGenerateError'

import { canonicalGenerate } from '../../model/canonicalGenerate'
import type { AihubmixPaintingData } from '../../model/types/paintingData'
import type { GenerateInput } from '../types'
import { getAihubmixUploadedFile } from './imageUpload'

/**
 * Unified AiHubMix painting adapter on the composed AI-SDK-native
 * `createAihubmix().imageModel` (Phase 4a) — the sole AiHubMix painting path.
 * The provider-specific request/response (gemini stream, Ideogram V_3
 * FormData, Ideogram V_1/V_2 JSON, and the default gpt-image/FLUX/imagen
 * delegate) runs inside the composed `ImageModelV3`; R1 routes URL outputs
 * back through the main-process downloader (Ideogram URLs keep the bespoke
 * proxy-warning hint).
 *
 * All bespoke painting fields and the remix/upscale upload blob are forwarded
 * by reference through `providerOptions.aihubmix` — the exact key the inner
 * `OpenAICompatibleImageModel` also reads, so the default-delegate models
 * still receive their fields.
 */

type AihubmixMode = 'generate' | 'remix' | 'upscale'
type ImageFileBlob = { mediaType: string; data: Uint8Array; name: string }

interface ResolvedModelParams {
  imageSize: string
  batchSize: number
  safetyTolerance: number | undefined
}

const aspectRatioSize = (p: AihubmixPaintingData) => p.aspectRatio?.replace('ASPECT_', '').replace('_', ':') || '1:1'
const pixelSize = (p: AihubmixPaintingData) => (p.size && p.size !== 'auto' ? p.size : '1024x1024')
const numImagesBatch = (p: AihubmixPaintingData) => p.numImages ?? p.n ?? 1

/**
 * Per-model-family parameter shaping. First rule whose `match` passes wins;
 * the `default` rule (no `match`) is the fallthrough.
 *
 * `buildBag` returns the `providerOptions.aihubmix` payload for that family
 * — kept narrow so gpt-image-2 / imagen / etc. don't inherit unrelated
 * fields left over in PaintingData from a prior model selection. The bespoke
 * routing in `aihubmix-image-model.ts` reads `bag.{aspectRatio,styleType,...}`
 * only for the V_x / gemini branches; the default branch
 * (`OpenAICompatibleImageModel`) spreads the bag verbatim into the
 * `/v1/images/generations` body, where extra fields can trip server-side
 * validation. Canonical AI-SDK fields (size/n/quality/background/moderation)
 * flow via `aiSdkParams` + `buildImageProviderOptions` — they do NOT need
 * to be in the bag.
 */
const MODEL_PARAM_RULES: ReadonlyArray<{
  match?: (modelId: string) => boolean
  resolve: (p: AihubmixPaintingData) => ResolvedModelParams
  buildBag: (p: AihubmixPaintingData, mode: AihubmixMode, imageFiles?: ImageFileBlob[]) => Record<string, unknown>
}> = [
  // Imagen-4 ultra — single image, aspectRatio via aiSdkParams.imageSize.
  // personGeneration travels in the bag (aihubmix routes imagen through
  // OpenAICompatibleImageModel; personGeneration isn't a canonical aiSdkParams
  // field for aihubmix in buildImageProviderOptions).
  {
    match: (id) => id.startsWith('imagen-4.0-ultra-generate'),
    resolve: (p) => ({ imageSize: aspectRatioSize(p), batchSize: 1, safetyTolerance: p.safetyTolerance }),
    buildBag: (p) => (p.personGeneration ? { personGeneration: p.personGeneration } : {})
  },
  {
    match: (id) => id.startsWith('imagen-'),
    resolve: (p) => ({
      imageSize: aspectRatioSize(p),
      batchSize: p.numberOfImages || 1,
      safetyTolerance: p.safetyTolerance
    }),
    buildBag: (p) => (p.personGeneration ? { personGeneration: p.personGeneration } : {})
  },
  // FLUX — needs safety_tolerance in body (snake_case, not in aiSdkParams).
  {
    match: (id) => id === 'FLUX.1-Kontext-pro',
    resolve: (p) => ({
      imageSize: pixelSize(p),
      batchSize: numImagesBatch(p),
      safetyTolerance: p.safetyTolerance ?? 6
    }),
    buildBag: (p) => ({ safety_tolerance: p.safetyTolerance ?? 6 })
  },
  // Gemini — aihubmix-image-model's gemini branch reads bag.aspectRatio / bag.imageSize.
  {
    match: (id) => id === 'gemini-3-pro-image-preview',
    resolve: (p) => ({ imageSize: pixelSize(p), batchSize: numImagesBatch(p), safetyTolerance: p.safetyTolerance }),
    buildBag: (p) => ({ aspectRatio: p.aspectRatio, imageSize: p.imageSize })
  },
  // Ideogram V_3 — handled by aihubmix-image-model's V_3 FormData branch
  // (generate/remix) and the bespoke /ideogram/upscale branch (upscale).
  // The branches read every field below.
  {
    match: (id) => id === 'V_3',
    resolve: (p) => ({ imageSize: pixelSize(p), batchSize: numImagesBatch(p), safetyTolerance: p.safetyTolerance }),
    buildBag: (p, mode, imageFiles) => ({
      mode,
      aspectRatio: p.aspectRatio,
      styleType: p.styleType,
      renderingSpeed: p.renderingSpeed,
      numImages: p.numImages,
      seed: p.seed,
      negativePrompt: p.negativePrompt,
      magicPromptOption: p.magicPromptOption,
      imageWeight: p.imageWeight,
      resemblance: p.resemblance,
      detail: p.detail,
      imageFiles
    })
  },
  // Other Ideogram V_* (V_1/V_2, plus V_*_TURBO / V_*A variants that fall
  // through to the bespoke /ideogram/{generate,remix,upscale} JSON+FormData
  // branch in non-generate modes). renderingSpeed isn't read by that branch.
  {
    match: (id) => id.startsWith('V_'),
    resolve: (p) => ({ imageSize: pixelSize(p), batchSize: numImagesBatch(p), safetyTolerance: p.safetyTolerance }),
    buildBag: (p, mode, imageFiles) => ({
      mode,
      aspectRatio: p.aspectRatio,
      styleType: p.styleType,
      numImages: p.numImages,
      seed: p.seed,
      negativePrompt: p.negativePrompt,
      magicPromptOption: p.magicPromptOption,
      imageWeight: p.imageWeight,
      resemblance: p.resemblance,
      detail: p.detail,
      imageFiles
    })
  },
  // Default — gpt-image-1, gpt-image-2, and unknown ids in generate mode.
  // Empty bag: every supported field (size/n/quality/background/moderation)
  // already flows via aiSdkParams + buildImageProviderOptions.
  {
    resolve: (p) => ({ imageSize: pixelSize(p), batchSize: numImagesBatch(p), safetyTolerance: p.safetyTolerance }),
    buildBag: () => ({})
  }
]

function resolveModelParams(modelId: string, painting: AihubmixPaintingData): ResolvedModelParams {
  const rule = MODEL_PARAM_RULES.find((r) => !r.match || r.match(modelId))
  return rule!.resolve(painting)
}

function buildModelBag(
  modelId: string,
  painting: AihubmixPaintingData,
  mode: AihubmixMode,
  imageFiles?: ImageFileBlob[]
): Record<string, unknown> {
  const rule = MODEL_PARAM_RULES.find((r) => !r.match || r.match(modelId))
  return rule!.buildBag(painting, mode, imageFiles)
}

export async function generateWithAihubmixUnified(input: GenerateInput) {
  // The painting provider registry passes the union `GenerateInput<PaintingData>`;
  // narrow once at the entry so the resolver/providerBag callbacks receive
  // the typed `AihubmixPaintingData` instead of the union (which excludes
  // `aspectRatio` / `styleType` / etc).
  const narrowedInput = input as GenerateInput<AihubmixPaintingData>
  const painting = narrowedInput.painting
  const { tab } = input
  const mode = tab as 'generate' | 'remix' | 'upscale'

  // Pre-fetch the upload blob synchronously so providerBag (which
  // canonicalGenerate invokes sync) hands it off by reference.
  let imageFiles: ImageFileBlob[] | undefined
  if (mode === 'remix' || mode === 'upscale') {
    if (!painting.imageFile) throw createPaintingGenerateError('IMAGE_REQUIRED')
    const uploadFile = getAihubmixUploadedFile(painting.imageFile)
    if (!uploadFile) throw createPaintingGenerateError('IMAGE_RETRY_REQUIRED')
    imageFiles = [
      { mediaType: uploadFile.type, data: new Uint8Array(await uploadFile.arrayBuffer()), name: uploadFile.name }
    ]
  }

  return canonicalGenerate(narrowedInput, {
    // Upscale tab accepts an empty prompt; generate/remix require it.
    requirePrompt: mode !== 'upscale',
    resolvers: {
      imageSize: (p) => (p.model ? resolveModelParams(p.model, p).imageSize : undefined),
      batchSize: (p) => (p.model ? resolveModelParams(p.model, p).batchSize : 1)
    },
    providerBag: (p) => (p.model ? buildModelBag(p.model, p, mode, imageFiles) : {}),
    downloadOptions: { showProxyWarning: true }
  })
}
