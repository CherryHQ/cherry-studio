import { AiProvider } from '@renderer/aiCore'
import type { Model } from '@renderer/types'

import { createPaintingGenerateError } from '../../model/paintingGenerateError'
import { runPainting } from '../../model/paintingGenerationService'
import type { OvmsPaintingData } from '../../model/types/paintingData'
import type { GenerateInput } from '../types'

/**
 * Unified OVMS painting adapter on the AI-SDK-native single-shot
 * `PollingImageModel` (proven `providers/zhipu/generate.ts` /
 * `providers/ppio/generateUnified.ts` pattern). Validation mirrors the bespoke
 * `generateWithOvms` exactly — OVMS is a local OpenVINO Model Server with NO
 * auth, so (unlike every other adapter) it does NOT call `checkProviderEnabled`
 * and passes an empty `apiKey`. The single `${apiHost}/images/generations`
 * request/response runs inside the relocated transport; the patched `ai` SDK
 * passes the returned image URLs / `data:` strings through
 * `convertImageResult`.
 *
 * Provider-specific painting fields are forwarded through
 * `providerOptions['ovms']`; the local host arrives as the resolved
 * `provider.apiHost` (used as the transport `baseURL`, no auth header).
 */
export async function generateWithOvmsUnified(input: GenerateInput<OvmsPaintingData>) {
  const { painting, provider, abortController } = input

  if (!painting.model) {
    throw createPaintingGenerateError('MISSING_REQUIRED_FIELDS')
  }

  if (!painting.prompt?.trim()) {
    throw createPaintingGenerateError('PROMPT_REQUIRED')
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
      apiKey: '',
      apiHost: provider.apiHost,
      models: [model],
      enabled: provider.isEnabled
    })

    const ovmsProviderOptions = {
      ovms: {
        model: modelId,
        size: painting.size,
        numInferenceSteps: painting.num_inference_steps,
        rngSeed: painting.rng_seed
      }
    }

    const images = await aiProvider.generateImage({
      model: modelId,
      prompt: painting.prompt ?? '',
      imageSize: painting.size ?? '512x512',
      batchSize: 1,
      providerOptions: ovmsProviderOptions,
      signal: abortController.signal
    })

    if (images.length > 0) {
      return { base64s: images }
    }

    return undefined
  })
}
