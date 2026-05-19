import { AiProvider } from '@renderer/aiCore'
import type { Model } from '@renderer/types'

import { createPaintingGenerateError } from '../../model/paintingGenerateError'
import { runPainting } from '../../model/paintingGenerationService'
import type { TokenFluxPaintingData as TokenFluxPainting } from '../../model/types/paintingData'
import { checkProviderEnabled } from '../../utils/checkProviderEnabled'
import type { GenerateInput } from '../types'

/**
 * Unified TokenFlux painting adapter on the AI-SDK-native `PollingImageModel`
 * (proven `providers/zhipu/generate.ts` pattern). Validation mirrors the
 * bespoke `generateWithTokenFlux` exactly. The TokenFlux submit/poll transport
 * runs inside the custom `ImageModelV3`; the patched `ai` SDK auto-downloads
 * the returned image URLs into base64 read by `convertImageResult`.
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

    const images = await aiProvider.generateImage({
      model: modelId,
      prompt,
      imageSize: '1024x1024',
      batchSize: 1,
      providerOptions: tokenFluxProviderOptions,
      signal: abortController.signal
    })

    if (images.length > 0) {
      return { base64s: images }
    }

    return undefined
  })
}
