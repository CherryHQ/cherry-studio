import { AiProvider } from '@renderer/aiCore'
import type { Model } from '@renderer/types'

import { createPaintingGenerateError } from '../../model/paintingGenerateError'
import { runPainting } from '../../model/paintingGenerationService'
import type { TokenFluxPaintingData as TokenFluxPainting } from '../../model/types/paintingData'
import { checkProviderEnabled } from '../../utils/checkProviderEnabled'
import type { GenerateInput } from '../types'

/**
 * Unified TokenFlux painting adapter on the AI-SDK-native `PollingImageModel`
 * — the sole TokenFlux painting path (the bespoke generate.ts was deleted in
 * the cutover). The submit/poll transport runs inside the custom
 * `ImageModelV3`; URL outputs go through the main-process `downloadImages`
 * (R1) — proxy-aware, per-URL partial success, empty-URL toast all preserved.
 *
 * The dynamic `input_schema` fields (`painting.inputParams`) and progress
 * are forwarded through `providerOptions['tokenflux']` (passed by reference
 * through the plugin chain, so the non-JSON callback survives).
 */
export async function generateWithTokenFluxUnified(input: GenerateInput<TokenFluxPainting>) {
  const { painting, provider, abortController } = input

  const apiKey = await checkProviderEnabled(provider)

  const prompt = painting.prompt || ''

  if (!painting.model || !prompt) {
    throw createPaintingGenerateError('TEXT_DESC_REQUIRED')
  }

  const modelId = painting.model

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

    const tokenFluxProviderOptions = {
      tokenflux: {
        model: modelId,
        inputParams: painting.inputParams || {},
        onProgress: (progress: number) => {
          input.onGenerationStateChange?.({ generationProgress: progress })
        }
      }
    }

    const out = await aiProvider.generatePaintingImage({
      model: modelId,
      prompt,
      imageSize: '1024x1024',
      batchSize: 1,
      providerOptions: tokenFluxProviderOptions,
      signal: abortController.signal
    })

    const urls = out.flatMap((o) => (o.type === 'url' ? [o.url] : []))
    if (urls.length > 0) {
      return { urls }
    }
    const base64s = out.flatMap((o) => (o.type === 'base64' ? [o.base64] : []))
    if (base64s.length > 0) {
      return { base64s }
    }

    return undefined
  })
}
