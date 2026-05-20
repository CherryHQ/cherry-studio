import { generatePainting } from '../../model/generatePainting'
import { createPaintingGenerateError } from '../../model/paintingGenerateError'
import type { AihubmixPaintingData } from '../../model/types/paintingData'
import { checkProviderEnabled } from '../../utils/checkProviderEnabled'
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
 * `OpenAICompatibleImageModel` also reads (`providerOptionsKey` =
 * `'aihubmix.image'.split('.')[0]` = `'aihubmix'`), so the default-delegate
 * models still receive their fields.
 */

/** The painting fields the per-model parameter rules read. */
type ModelParamInput = Pick<
  AihubmixPaintingData,
  'aspectRatio' | 'size' | 'numImages' | 'n' | 'numberOfImages' | 'safetyTolerance'
>

interface ResolvedModelParams {
  /** AI-SDK `imageSize` (pixel size for most models, aspect ratio for imagen). */
  imageSize: string
  /** AI-SDK `batchSize`. */
  batchSize: number
  /** Forwarded as `providerOptions.aihubmix.safety_tolerance`. */
  safetyTolerance: number | undefined
}

const aspectRatioSize = (p: ModelParamInput) => p.aspectRatio?.replace('ASPECT_', '').replace('_', ':') || '1:1'
const pixelSize = (p: ModelParamInput) => (p.size && p.size !== 'auto' ? p.size : '1024x1024')
const numImagesBatch = (p: ModelParamInput) => p.numImages ?? p.n ?? 1

/**
 * Per-model-family parameter shaping, relocated table-first from the bespoke
 * `generate.ts` if/else chain. First rule whose `match` passes wins; the
 * `default` rule (no `match`) is the fallthrough. Adding a model family is one
 * row, not another branch.
 */
const MODEL_PARAM_RULES: ReadonlyArray<{
  match?: (modelId: string) => boolean
  resolve: (p: ModelParamInput) => ResolvedModelParams
}> = [
  // imagen-4.0-ultra: aspect-ratio size, capped at a single image.
  {
    match: (id) => id.startsWith('imagen-4.0-ultra-generate'),
    resolve: (p) => ({ imageSize: aspectRatioSize(p), batchSize: 1, safetyTolerance: p.safetyTolerance })
  },
  // other imagen-*: aspect-ratio size, numberOfImages batch.
  {
    match: (id) => id.startsWith('imagen-'),
    resolve: (p) => ({
      imageSize: aspectRatioSize(p),
      batchSize: p.numberOfImages || 1,
      safetyTolerance: p.safetyTolerance
    })
  },
  // FLUX.1-Kontext-pro: pixel size, defaults safety_tolerance to 6 when unset.
  {
    match: (id) => id === 'FLUX.1-Kontext-pro',
    resolve: (p) => ({ imageSize: pixelSize(p), batchSize: numImagesBatch(p), safetyTolerance: p.safetyTolerance ?? 6 })
  },
  // gpt-image-1/2 and any other id: pixel size, raw safety_tolerance.
  {
    resolve: (p) => ({ imageSize: pixelSize(p), batchSize: numImagesBatch(p), safetyTolerance: p.safetyTolerance })
  }
]

function resolveModelParams(modelId: string, painting: ModelParamInput): ResolvedModelParams {
  const rule = MODEL_PARAM_RULES.find((r) => !r.match || r.match(modelId))
  // The last rule has no `match`, so `find` always resolves.
  return rule!.resolve(painting)
}

export async function generateWithAihubmixUnified(input: GenerateInput) {
  const { painting: rawPainting, provider, tab, abortController } = input
  const painting = rawPainting as AihubmixPaintingData
  const mode = tab as 'generate' | 'remix' | 'upscale'
  const apiKey = await checkProviderEnabled(provider)
  if (!painting.model) throw createPaintingGenerateError('MISSING_REQUIRED_FIELDS')
  const prompt = painting.prompt || ''
  if (mode !== 'upscale' && !prompt.trim()) throw createPaintingGenerateError('PROMPT_REQUIRED')

  let uploadFile: File | null = null
  if (mode === 'remix' || mode === 'upscale') {
    if (!painting.imageFile) throw createPaintingGenerateError('IMAGE_REQUIRED')
    uploadFile = getAihubmixUploadedFile(painting.imageFile)
    if (!uploadFile) throw createPaintingGenerateError('IMAGE_RETRY_REQUIRED')
  }

  const imageFiles = uploadFile
    ? [{ mediaType: uploadFile.type, data: new Uint8Array(await uploadFile.arrayBuffer()), name: uploadFile.name }]
    : undefined

  const { imageSize, batchSize, safetyTolerance } = resolveModelParams(painting.model, painting)

  // Ideogram (V_1/V_2/V_3) returns proxied URLs — download them through the
  // main-process downloader with the bespoke proxy hint; gpt-image / FLUX /
  // imagen come back as base64. `generatePainting` stamps `downloadOptions`
  // only on the URL branch.
  return generatePainting({
    provider,
    signal: abortController.signal,
    apiKey,
    modelId: painting.model,
    prompt,
    aiSdkParams: { imageSize, batchSize },
    providerBag: {
      mode,
      aspectRatio: painting.aspectRatio,
      imageSize: painting.imageSize,
      styleType: painting.styleType,
      renderingSpeed: painting.renderingSpeed,
      numImages: painting.numImages,
      seed: painting.seed,
      negativePrompt: painting.negativePrompt,
      magicPromptOption: painting.magicPromptOption,
      imageWeight: painting.imageWeight,
      resemblance: painting.resemblance,
      detail: painting.detail,
      personGeneration: painting.personGeneration,
      quality: painting.quality,
      moderation: painting.moderation,
      safety_tolerance: safetyTolerance,
      n: painting.n,
      imageFiles
    },
    downloadOptions: { showProxyWarning: true }
  })
}
