import { createPaintingGenerateError } from '@renderer/aiCore/errors/paintingGenerateError'

import { canonicalGenerate } from '../../model/canonicalGenerate'
import type { GenerateInput } from '../shared/provider'
import type { TokenFluxPainting } from './config'

/**
 * TokenFlux painting adapter. The submit/poll transport runs inside the custom
 * `ImageModelV3`; URL outputs go through the main-process `downloadImages`.
 * Per-model JSON-Schema-driven form values live in
 * `params.inputParams` and flow through canonicalGenerate's providerOptions
 * bag verbatim.
 */
export async function generateWithTokenFluxUnified(input: GenerateInput<TokenFluxPainting>) {
  return canonicalGenerate(input, {
    preValidate: (painting) => {
      if (!painting.model || !(painting.prompt ?? '').trim()) {
        throw createPaintingGenerateError('TEXT_DESC_REQUIRED')
      }
    }
  })
}
