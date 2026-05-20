import { generatePainting } from '../../model/generatePainting'
import { createPaintingGenerateError } from '../../model/paintingGenerateError'
import type { OvmsPaintingData } from '../../model/types/paintingData'
import type { GenerateInput } from '../types'

/**
 * Unified OVMS painting adapter. OVMS is a local OpenVINO Model Server with
 * NO auth, so (unlike every other adapter) it does NOT call
 * `checkProviderEnabled` and passes an empty `apiKey`. The single
 * `${apiHost}/images/generations` request/response runs inside the
 * `pollingTransports/ovms.ts` transport; URL outputs go through the
 * main-process `downloadImages`, base64 outputs are saved directly (via R1).
 */
export async function generateWithOvmsUnified(input: GenerateInput<OvmsPaintingData>) {
  const { painting, provider, abortController } = input
  if (!painting.model) throw createPaintingGenerateError('MISSING_REQUIRED_FIELDS')
  const prompt = painting.prompt ?? ''
  if (!prompt.trim()) throw createPaintingGenerateError('PROMPT_REQUIRED')

  return generatePainting({
    provider,
    signal: abortController.signal,
    apiKey: '',
    modelId: painting.model,
    prompt,
    aiSdkParams: {
      imageSize: painting.size ?? '512x512',
      batchSize: 1
    },
    providerBag: {
      model: painting.model,
      size: painting.size,
      numInferenceSteps: painting.num_inference_steps,
      rngSeed: painting.rng_seed
    }
  })
}
