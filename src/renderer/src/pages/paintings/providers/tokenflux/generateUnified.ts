import { createPaintingGenerateError } from '@renderer/aiCore/errors/paintingGenerateError'

import { canonicalGenerate } from '../../model/canonicalGenerate'
import type { TokenFluxPaintingData as TokenFluxPainting } from '../../model/types/paintingData'
import type { GenerateInput } from '../types'

/**
 * Unified TokenFlux painting adapter.
 *
 * The submit/poll transport runs inside the custom `ImageModelV3`; URL
 * outputs go through the main-process `downloadImages` (R1). The dynamic
 * `input_schema` fields (`painting.inputParams`) and the polling progress
 * callback are forwarded by reference through providerBag.
 */
export async function generateWithTokenFluxUnified(input: GenerateInput<TokenFluxPainting>) {
  return canonicalGenerate(input, {
    preValidate: (painting) => {
      if (!painting.model || !(painting.prompt ?? '').trim()) {
        throw createPaintingGenerateError('TEXT_DESC_REQUIRED')
      }
    },
    constants: { imageSize: '1024x1024', batchSize: 1 },
    providerBag: (painting) => ({
      model: painting.model,
      inputParams: painting.inputParams || {},
      onProgress: (progress: number) => {
        input.onGenerationStateChange?.({ generationProgress: progress })
      }
    })
  })
}
