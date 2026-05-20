import { AiProvider } from '@renderer/aiCore'
import type { Model } from '@renderer/types'

import { createPaintingGenerateError } from '../../model/paintingGenerateError'
import { runPainting } from '../../model/paintingGenerationService'
import type { DmxapiPaintingData as DmxapiPainting } from '../../model/types/paintingData'
import { generationModeType } from '../../model/types/paintingData'
import { checkProviderEnabled } from '../../utils/checkProviderEnabled'
import type { GenerateInput } from '../types'
import { getDmxapiFileMap } from './runtime'

/**
 * Unified DMXAPI painting adapter on the AI-SDK-native single-shot
 * `PollingImageModel` — the sole DMXAPI painting path (the bespoke
 * single-shot was deleted in the cutover). The DMXAPI request/response
 * (V1 JSON generations vs V2 FormData edits, Bearer auth, `extend_params`,
 * seed `-1` sentinel, `style_type` prepend, inline-base64 / FormData blobs)
 * runs inside the relocated transport; URL outputs go through the
 * main-process `downloadImages` with `allowBase64DataUrls` (some DMXAPI
 * models return data URLs in the URL slot), base64 outputs are saved
 * directly. Typed 401/403 errors map to `REQ_ERROR_TOKEN` /
 * `REQ_ERROR_NO_BALANCE` (transport, R3).
 *
 * DMXAPI file blobs (the `getDmxapiFileMap()` upload store, mode-keyed) and all
 * provider-specific painting fields are forwarded by reference through
 * `providerOptions['dmxapi']`. Files carry their original MIME type so the V1
 * inline-base64 / V2 FormData branches stay byte-identical to the bespoke
 * service (the AI SDK `editImage` path would lose the source MIME through its
 * Uint8Array conversion, so the upload store is forwarded directly instead).
 */
export async function generateWithDmxapiUnified(input: GenerateInput<DmxapiPainting>) {
  const { painting, provider, abortController, tab } = input
  const mode = tab || generationModeType.GENERATION

  const apiKey = await checkProviderEnabled(provider)

  if (!painting.model) {
    throw createPaintingGenerateError('MISSING_REQUIRED_FIELDS')
  }

  if (!painting.prompt) {
    throw createPaintingGenerateError('TEXT_DESC_REQUIRED')
  }

  if (
    [generationModeType.EDIT, generationModeType.MERGE].includes(mode as generationModeType) &&
    getDmxapiFileMap().imageFiles.length === 0
  ) {
    throw createPaintingGenerateError('IMAGE_HANDLE_REQUIRED')
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

    const dmxapiProviderOptions = {
      dmxapi: {
        model: modelId,
        n: painting.n,
        imageSize: painting.image_size,
        seed: painting.seed,
        styleType: painting.style_type,
        mode,
        extendParams: painting.extend_params,
        imageFiles
      }
    }

    const out = await aiProvider.generatePaintingImage({
      model: modelId,
      prompt: painting.prompt ?? '',
      imageSize: painting.image_size ?? '1024x1024',
      batchSize: painting.n ?? 1,
      providerOptions: dmxapiProviderOptions,
      signal: abortController.signal
    })

    // DMXAPI's `data.data[].url` items may be either http URLs or inline
    // `data:` URLs (depending on the model); the bespoke path passed both
    // through `downloadImages` with `allowBase64DataUrls:true`.
    const urls = out.flatMap((o) => (o.type === 'url' ? [o.url] : []))
    if (urls.length > 0) {
      return { urls, downloadOptions: { allowBase64DataUrls: true } }
    }
    const base64s = out.flatMap((o) => (o.type === 'base64' ? [o.base64] : []))
    if (base64s.length > 0) {
      return { base64s }
    }

    return undefined
  })
}
