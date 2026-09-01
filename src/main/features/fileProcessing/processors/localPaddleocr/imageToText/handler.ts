import { application } from '@application'
import { ocrModelPaths } from '@main/ai/inference/ocrModelPaths'
import { isLocalModelReady } from '@main/services/localModel'
import { FILE_TYPE } from '@shared/types/file'

import type { FileProcessingCapabilityHandler } from '../../types'

/**
 * In-process OCR via PaddleOCR (ppu-paddle-ocr). Recognition runs in the
 * inference worker off the main thread; the model must be downloaded first.
 * The processor stays visible and selectable while it is not — this guard is
 * what turns that into a message the user can act on.
 */
export const localPaddleocrImageToTextHandler: FileProcessingCapabilityHandler<'image_to_text'> = {
  mode: 'background',
  imageOcrOutput: 'spatial-text',
  prepare(file, _config, signal) {
    signal?.throwIfAborted()
    if (file.type !== FILE_TYPE.IMAGE) {
      throw new Error('Local PaddleOCR only supports image files')
    }
    if (!isLocalModelReady('ocr')) {
      throw new Error('Local PaddleOCR model is not downloaded')
    }
    const modelPaths = ocrModelPaths()

    return {
      mode: 'background',
      async execute(executionContext) {
        const { text, lines } = await application
          .get('OcrInferenceService')
          .recognize(modelPaths, { kind: 'path', imagePath: file.path }, executionContext.signal)
        return { kind: 'spatial-text', text, lines }
      }
    }
  }
}
