import { AiProvider } from '@renderer/aiCore'
import type { Model } from '@renderer/types'

import { createPaintingGenerateError } from '../../model/paintingGenerateError'
import { runPainting } from '../../model/paintingGenerationService'
import type { OvmsPaintingData } from '../../model/types/paintingData'
import type { GenerateInput } from '../types'

/**
 * Unified OVMS painting adapter on the AI-SDK-native single-shot
 * `PollingImageModel` — the sole OVMS painting path (the bespoke
 * single-shot was deleted in the cutover). OVMS is a local OpenVINO Model
 * Server with NO auth, so (unlike every other adapter) it does NOT call
 * `checkProviderEnabled` and passes an empty `apiKey`. The single
 * `${apiHost}/images/generations` request/response runs inside the
 * relocated transport; URL outputs go through the main-process
 * `downloadImages`, base64 outputs are saved directly (via R1).
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

    const out = await aiProvider.generatePaintingImage({
      model: modelId,
      prompt: painting.prompt ?? '',
      imageSize: painting.size ?? '512x512',
      batchSize: 1,
      providerOptions: ovmsProviderOptions,
      signal: abortController.signal
    })

    // OVMS may return either http URLs (download via main process) or
    // base64; bespoke distinguished the two and so do we.
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
