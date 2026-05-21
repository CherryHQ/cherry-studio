import { createPaintingGenerateError } from '@renderer/aiCore/errors/paintingGenerateError'

import { canonicalGenerate } from '../../model/canonicalGenerate'
import type { DmxapiPaintingData as DmxapiPainting } from '../../model/types/paintingData'
import { generationModeType } from '../../model/types/paintingData'
import type { GenerateInput } from '../types'
import { getDmxapiFileMap } from './runtime'

/**
 * Unified DMXAPI painting adapter.
 *
 * DMXAPI's request shape (V1 JSON / V2 FormData, Bearer auth, `extend_params`,
 * seed `-1` sentinel, inline-base64 / FormData blobs) lives in the polling
 * transport; this file only feeds the canonical `generatePainting` pipeline
 * with DMXAPI's vendor extras via `providerBag`.
 *
 * Upload blobs (`getDmxapiFileMap()` store, mode-keyed) are pre-converted to
 * `{ mediaType, data, name }` tuples before `canonicalGenerate` fires so the
 * sync `providerBag` callback can forward them by reference. Files keep their
 * original MIME type so the V1 inline-base64 / V2 FormData transport branches
 * stay byte-identical.
 *
 * Typed 401/403 errors map to `REQ_ERROR_TOKEN`/`REQ_ERROR_NO_BALANCE` in the
 * transport (R3). URL outputs accept inline base64 data URLs (some DMXAPI
 * models return them in the URL slot) via `allowBase64DataUrls: true`.
 */
export async function generateWithDmxapiUnified(input: GenerateInput<DmxapiPainting>) {
  const { tab } = input
  const mode = tab || generationModeType.GENERATION

  // Pre-fetch the upload blobs synchronously so the providerBag callback
  // (which canonicalGenerate invokes sync) can hand them off by reference.
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

  return canonicalGenerate(input, {
    preValidate: (painting) => {
      if (!painting.prompt) throw createPaintingGenerateError('TEXT_DESC_REQUIRED')
      if (
        [generationModeType.EDIT, generationModeType.MERGE].includes(mode as generationModeType) &&
        getDmxapiFileMap().imageFiles.length === 0
      ) {
        throw createPaintingGenerateError('IMAGE_HANDLE_REQUIRED')
      }
    },
    fieldMap: { imageSize: 'image_size', batchSize: 'n' },
    defaults: { imageSize: '1024x1024', batchSize: 1 },
    providerBag: (painting) => ({
      model: painting.model,
      n: painting.n,
      imageSize: painting.image_size,
      seed: painting.seed,
      mode,
      extendParams: painting.extend_params,
      imageFiles
    }),
    downloadOptions: { allowBase64DataUrls: true }
  })
}
