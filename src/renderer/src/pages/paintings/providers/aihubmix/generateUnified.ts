import { AiProvider } from '@renderer/aiCore'
import type { Model } from '@renderer/types'

import { createPaintingGenerateError } from '../../model/paintingGenerateError'
import { runPainting } from '../../model/paintingGenerationService'
import type { AihubmixPaintingData } from '../../model/types/paintingData'
import { checkProviderEnabled } from '../../utils/checkProviderEnabled'
import type { GenerateInput } from '../types'
import { getAihubmixUploadedFile } from './imageUpload'

/**
 * Unified AiHubMix painting adapter on the composed AI-SDK-native
 * `createAihubmix().imageModel` (Phase 4a) — the sole AiHubMix painting path
 * (the bespoke single-shot `generate.ts` was deleted in the cutover). The
 * provider-specific request/response
 * (gemini stream, Ideogram V_3 FormData, Ideogram V_1/V_2 JSON, and the
 * default gpt-image/FLUX/imagen delegate) runs inside the composed
 * `ImageModelV3`; the patched `ai` SDK passes the returned image URLs /
 * `data:` strings through `convertImageResult` (http urls are downloaded to
 * base64).
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

  const prompt = painting.prompt || ''

  if (!painting.model) {
    throw createPaintingGenerateError('MISSING_REQUIRED_FIELDS')
  }

  if (mode !== 'upscale' && !prompt.trim()) {
    throw createPaintingGenerateError('PROMPT_REQUIRED')
  }

  const modelId = painting.model

  let uploadFile: File | null = null
  if (mode === 'remix' || mode === 'upscale') {
    if (!painting.imageFile) {
      throw createPaintingGenerateError('IMAGE_REQUIRED')
    }
    uploadFile = getAihubmixUploadedFile(painting.imageFile)
    if (!uploadFile) {
      throw createPaintingGenerateError('IMAGE_RETRY_REQUIRED')
    }
  }

  return runPainting(async () => {
    const model = {
      id: modelId,
      provider: provider.id,
      name: modelId,
      group: ''
    } as Model

    const aiProvider = new AiProvider(model, {
      id: provider.id,
      type: 'openai',
      name: provider.name,
      apiKey,
      apiHost: provider.apiHost,
      models: [model],
      enabled: provider.isEnabled
    })

    const imageFiles = uploadFile
      ? [
          {
            mediaType: uploadFile.type,
            data: new Uint8Array(await uploadFile.arrayBuffer()),
            name: uploadFile.name
          }
        ]
      : undefined

    const { imageSize, batchSize, safetyTolerance } = resolveModelParams(modelId, painting)

    const aihubmixProviderOptions = {
      aihubmix: {
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
      }
    }

    const out = await aiProvider.generatePaintingImage({
      model: modelId,
      prompt,
      imageSize,
      batchSize,
      providerOptions: aihubmixProviderOptions,
      signal: abortController.signal
    })

    // Ideogram (V_1/V_2/V_3) returns proxied URLs — download them through the
    // main-process downloader with the bespoke proxy hint; gpt-image / FLUX /
    // imagen come back as base64.
    const urls = out.flatMap((o) => (o.type === 'url' ? [o.url] : []))
    if (urls.length > 0) {
      return { urls, downloadOptions: { showProxyWarning: true } }
    }
    const base64s = out.flatMap((o) => (o.type === 'base64' ? [o.base64] : []))
    if (base64s.length > 0) {
      return { base64s }
    }

    return undefined
  })
}
