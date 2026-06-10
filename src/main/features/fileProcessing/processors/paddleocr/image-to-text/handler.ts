import { PaddleOCRClient } from '@paddleocr/api-sdk'
import type { FileProcessorMerged } from '@shared/data/presets/file-processing'
import { FILE_TYPE, type FileInfo } from '@shared/file/types'
import { net } from 'electron'

import { getRequiredApiHost, getRequiredApiKey, getRequiredCapability } from '../../../utils/provider'
import type { FileProcessingCapabilityHandler } from '../../types'

/** Capability handler that extracts text from images via PaddleOCR. */
export const paddleImageToTextHandler: FileProcessingCapabilityHandler<'image_to_text'> = {
  mode: 'background',
  /** Validates inputs and returns a background executor that calls the OCR API. */
  prepare(file, config, signal) {
    signal?.throwIfAborted()
    const { apiHost, apiKey, model } = prepareContext(file, config, signal)

    return {
      mode: 'background',
      async execute(executionContext) {
        const client = new PaddleOCRClient({
          token: apiKey,
          baseUrl: apiHost,
          fetch: net.fetch as typeof fetch
        })
        const result = await client.ocr({ filePath: file.path, model }, { signal: executionContext.signal })
        const text = result.pages.flatMap((p) => (p.prunedResult as any)?.rec_texts ?? []).join('\n')
        return { kind: 'text', text }
      }
    }
  }
}

/** Extracts API credentials and model from config for image OCR. */
function prepareContext(file: FileInfo, config: FileProcessorMerged, signal?: AbortSignal) {
  signal?.throwIfAborted()
  const capability = getRequiredCapability(config, 'image_to_text', 'paddleocr')
  if (file.type !== FILE_TYPE.IMAGE) {
    throw new Error('PaddleOCR text extraction only supports image files')
  }
  return {
    apiHost: getRequiredApiHost(capability),
    apiKey: getRequiredApiKey(config, 'paddleocr'),
    model: capability.modelId?.trim() || undefined
  }
}
