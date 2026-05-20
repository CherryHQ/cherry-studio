import { generatePainting } from '../../model/generatePainting'
import { createPaintingGenerateError } from '../../model/paintingGenerateError'
import type { DmxapiPaintingData as DmxapiPainting } from '../../model/types/paintingData'
import { generationModeType } from '../../model/types/paintingData'
import { checkProviderEnabled } from '../../utils/checkProviderEnabled'
import type { GenerateInput } from '../types'
import { getDmxapiFileMap } from './runtime'

/**
 * Unified DMXAPI painting adapter. The DMXAPI request/response (V1 JSON
 * generations vs V2 FormData edits, Bearer auth, `extend_params`, seed `-1`
 * sentinel, `style_type` prepend, inline-base64 / FormData blobs) runs inside
 * the relocated transport. URL outputs go through the main-process
 * `downloadImages` with `allowBase64DataUrls` (some DMXAPI models return
 * inline data URLs in the URL slot); base64 outputs are saved directly.
 * Typed 401/403 errors map to `REQ_ERROR_TOKEN`/`REQ_ERROR_NO_BALANCE` in
 * the transport (R3).
 *
 * DMXAPI upload blobs (the `getDmxapiFileMap()` store, mode-keyed) are
 * forwarded by reference through `providerOptions['dmxapi']`. Files keep
 * their original MIME type so the V1 inline-base64 / V2 FormData branches
 * stay byte-identical to the bespoke service.
 */
export async function generateWithDmxapiUnified(input: GenerateInput<DmxapiPainting>) {
  const { painting, provider, abortController, tab } = input
  const mode = tab || generationModeType.GENERATION
  const apiKey = await checkProviderEnabled(provider)
  if (!painting.model) throw createPaintingGenerateError('MISSING_REQUIRED_FIELDS')
  if (!painting.prompt) throw createPaintingGenerateError('TEXT_DESC_REQUIRED')
  if (
    [generationModeType.EDIT, generationModeType.MERGE].includes(mode as generationModeType) &&
    getDmxapiFileMap().imageFiles.length === 0
  ) {
    throw createPaintingGenerateError('IMAGE_HANDLE_REQUIRED')
  }

  const imageFiles = await Promise.all(
    getDmxapiFileMap().imageFiles.map(async (entry) => {
      const file = entry as unknown as File
      return {
        mediaType: file.type,
        data: new Uint8Array(await file.arrayBuffer()),
        name: file.name
      }
    })
  )

  return generatePainting({
    provider,
    signal: abortController.signal,
    apiKey,
    modelId: painting.model,
    prompt: painting.prompt ?? '',
    aiSdkParams: {
      imageSize: painting.image_size ?? '1024x1024',
      batchSize: painting.n ?? 1
    },
    providerBag: {
      model: painting.model,
      n: painting.n,
      imageSize: painting.image_size,
      seed: painting.seed,
      styleType: painting.style_type,
      mode,
      extendParams: painting.extend_params,
      imageFiles
    },
    downloadOptions: { allowBase64DataUrls: true }
  })
}
