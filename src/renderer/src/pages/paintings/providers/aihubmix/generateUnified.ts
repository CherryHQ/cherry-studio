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
 * `createAihubmix().imageModel` (Phase 4a). Validation mirrors the bespoke
 * `generateWithAihubmix` exactly. The provider-specific request/response
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
        safety_tolerance: painting.safetyTolerance,
        n: painting.n,
        imageFiles
      }
    }

    const imageSize = painting.size && painting.size !== 'auto' ? painting.size : '1024x1024'

    const images = await aiProvider.generateImage({
      model: modelId,
      prompt,
      imageSize,
      batchSize: painting.numImages ?? painting.n ?? 1,
      providerOptions: aihubmixProviderOptions,
      signal: abortController.signal
    })

    if (images.length > 0) {
      return { base64s: images }
    }

    return undefined
  })
}
