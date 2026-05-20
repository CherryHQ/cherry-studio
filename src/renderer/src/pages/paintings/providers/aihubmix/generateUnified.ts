import { canonicalGenerate } from '../../model/canonicalGenerate'
import { createPaintingGenerateError } from '../../model/paintingGenerateError'
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

/** The painting fields the per-model parameter rules read. */
type ModelParamInput = Pick<
  AihubmixPaintingData,
  'aspectRatio' | 'size' | 'numImages' | 'n' | 'numberOfImages' | 'safetyTolerance'
>

interface ResolvedModelParams {
  imageSize: string
  batchSize: number
  safetyTolerance: number | undefined
}

const aspectRatioSize = (p: ModelParamInput) => p.aspectRatio?.replace('ASPECT_', '').replace('_', ':') || '1:1'
const pixelSize = (p: ModelParamInput) => (p.size && p.size !== 'auto' ? p.size : '1024x1024')
const numImagesBatch = (p: ModelParamInput) => p.numImages ?? p.n ?? 1

/**
 * Per-model-family parameter shaping. First rule whose `match` passes wins;
 * the `default` rule (no `match`) is the fallthrough. Adding a model family
 * is one row, not another branch.
 */
const MODEL_PARAM_RULES: ReadonlyArray<{
  match?: (modelId: string) => boolean
  resolve: (p: ModelParamInput) => ResolvedModelParams
}> = [
  {
    match: (id) => id.startsWith('imagen-4.0-ultra-generate'),
    resolve: (p) => ({ imageSize: aspectRatioSize(p), batchSize: 1, safetyTolerance: p.safetyTolerance })
  },
  {
    match: (id) => id.startsWith('imagen-'),
    resolve: (p) => ({
      imageSize: aspectRatioSize(p),
      batchSize: p.numberOfImages || 1,
      safetyTolerance: p.safetyTolerance
    })
  },
  {
    match: (id) => id === 'FLUX.1-Kontext-pro',
    resolve: (p) => ({ imageSize: pixelSize(p), batchSize: numImagesBatch(p), safetyTolerance: p.safetyTolerance ?? 6 })
  },
  {
    resolve: (p) => ({ imageSize: pixelSize(p), batchSize: numImagesBatch(p), safetyTolerance: p.safetyTolerance })
  }
]

function resolveModelParams(modelId: string, painting: ModelParamInput): ResolvedModelParams {
  const rule = MODEL_PARAM_RULES.find((r) => !r.match || r.match(modelId))
  return rule!.resolve(painting)
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
  let imageFiles: { mediaType: string; data: Uint8Array; name: string }[] | undefined
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
    providerBag: (p) => {
      const safetyTolerance = p.model ? resolveModelParams(p.model, p).safetyTolerance : undefined
      return {
        mode,
        aspectRatio: p.aspectRatio,
        imageSize: p.imageSize,
        styleType: p.styleType,
        renderingSpeed: p.renderingSpeed,
        numImages: p.numImages,
        seed: p.seed,
        negativePrompt: p.negativePrompt,
        magicPromptOption: p.magicPromptOption,
        imageWeight: p.imageWeight,
        resemblance: p.resemblance,
        detail: p.detail,
        personGeneration: p.personGeneration,
        quality: p.quality,
        moderation: p.moderation,
        safety_tolerance: safetyTolerance,
        n: p.n,
        imageFiles
      }
    },
    downloadOptions: { showProxyWarning: true }
  })
}
