import { inferenceHost } from '@main/ai/inference/InferenceHost'
import { FILE_TYPE } from '@shared/types/file'

import type { FileProcessingCapabilityHandler } from '../../types'
import { isLocalPaddleocrModelDownloaded, ocrModelPaths } from '../modelPaths'

/**
 * In-process OCR via PaddleOCR (ppu-paddle-ocr). Recognition runs in the
 * inference worker off the main thread; the model files must be downloaded first
 * (the registry only marks this processor available once they are present).
 */
export const localPaddleocrImageToTextHandler: FileProcessingCapabilityHandler<'image_to_text'> = {
  mode: 'background',
  prepare(file, _config, signal) {
    signal?.throwIfAborted()
    if (file.type !== FILE_TYPE.IMAGE) {
      throw new Error('Local PaddleOCR only supports image files')
    }
    if (!isLocalPaddleocrModelDownloaded()) {
      throw new Error('Local PaddleOCR model is not downloaded')
    }
    const modelPaths = ocrModelPaths()

    return {
      mode: 'background',
      async execute(executionContext) {
        const text = await inferenceHost.recognize(modelPaths, file.path, executionContext.signal)
        return { kind: 'text', text }
      }
    }
  }
}
