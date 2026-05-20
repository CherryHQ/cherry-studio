import { generatePainting } from '../../model/generatePainting'
import { createPaintingGenerateError } from '../../model/paintingGenerateError'
import type { TokenFluxPaintingData as TokenFluxPainting } from '../../model/types/paintingData'
import { checkProviderEnabled } from '../../utils/checkProviderEnabled'
import type { GenerateInput } from '../types'

/**
 * Unified TokenFlux painting adapter. The submit/poll transport runs inside
 * the custom `ImageModelV3`; URL outputs go through the main-process
 * `downloadImages` (R1) — proxy-aware, per-URL partial success, empty-URL
 * toast all preserved. The dynamic `input_schema` fields
 * (`painting.inputParams`) and progress are forwarded by reference through
 * `providerOptions['tokenflux']`.
 */
export async function generateWithTokenFluxUnified(input: GenerateInput<TokenFluxPainting>) {
  const { painting, provider, abortController } = input
  const apiKey = await checkProviderEnabled(provider)
  const prompt = painting.prompt || ''
  if (!painting.model || !prompt) throw createPaintingGenerateError('TEXT_DESC_REQUIRED')

  return generatePainting({
    provider,
    signal: abortController.signal,
    apiKey,
    modelId: painting.model,
    prompt,
    aiSdkParams: {
      imageSize: '1024x1024',
      batchSize: 1
    },
    providerBag: {
      model: painting.model,
      inputParams: painting.inputParams || {},
      onProgress: (progress: number) => {
        input.onGenerationStateChange?.({ generationProgress: progress })
      }
    }
  })
}
