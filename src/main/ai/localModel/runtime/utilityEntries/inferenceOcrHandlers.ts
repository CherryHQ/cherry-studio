/**
 * OCR request handlers (PaddleOCR via ppu-paddle-ocr), split from the entry module so they
 * can be exercised in-process against a fake engine — `inferenceOcr.ts` only wires them to
 * the parent port.
 */

import { readFileSync } from 'node:fs'

import type { OcrModelPaths } from '@main/ai/localModel/capabilities/ocr/protocol'
import type { OcrInferenceContract } from '@main/ai/localModel/runtime/inferenceProcess'
import type { UtilityProcessHandlers } from '@main/core/utilityProcess/runtime/serveUtilityProcess'

import { cacheResource, currentRuntimeProfile, describeError, getPpu, withHardwareFallback } from './inferenceRuntime'

function getPaddleService(modelPaths: OcrModelPaths, logger: { info: (m: string) => void; warn: (m: string) => void }) {
  const key = `${modelPaths.detection}|${modelPaths.recognition}|${modelPaths.charactersDictionary}`
  return cacheResource(key, async () => {
    const { PaddleOcrService } = await getPpu()
    const profile = currentRuntimeProfile()
    let sessionFallbackError: unknown = null
    const service = new PaddleOcrService({
      model: {
        detection: modelPaths.detection,
        recognition: modelPaths.recognition,
        charactersDictionary: modelPaths.charactersDictionary
      },
      session: {
        ...profile.sessionOptions,
        onSessionFallback: (error: unknown) => {
          sessionFallbackError = sessionFallbackError || error
        }
      }
    })
    await service.initialize()
    if (sessionFallbackError) {
      try {
        await service.destroy()
      } catch (error) {
        logger.warn(`failed to dispose internally-fallen-back OCR service error=${describeError(error)}`)
      }
      throw new Error('OCR hardware session fell back internally to CPU', { cause: sessionFallbackError })
    }
    if (profile.id !== 'cpu') logger.info(`hardware provider active provider=${profile.id} runtime=ocr`)
    return service
  })
}

export const ocrHandlers: UtilityProcessHandlers<OcrInferenceContract> = {
  recognize: async ({ modelPaths, source }, { logger }) => {
    // Reading the image is request preparation, not a provider failure: keep it outside
    // the fallback so a missing file cannot be misread as broken hardware.
    const bytes = source.kind === 'bytes' ? source.imageBytes : readFileSync(source.imagePath)
    const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    return withHardwareFallback(
      async () => {
        const service = await getPaddleService(modelPaths, logger)
        const result = await service.recognize(arrayBuffer)
        // ppu types these as optional; normalize here so callers never branch on null.
        return { text: result.text ?? '', lines: result.lines ?? [] }
      },
      { logger, describeRequest: () => `request=ocr.recognize source=${source.kind}` }
    )
  }
}
