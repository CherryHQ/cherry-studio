import fs from 'node:fs/promises'

import type { FileProcessorMerged } from '@shared/data/presets/file-processing'
import { FILE_TYPE, type FileInfo } from '@shared/file/types'

import { getRequiredApiHost, getRequiredApiKey, getRequiredCapability } from '../../../utils/provider'
import type { FileProcessingCapabilityHandler } from '../../types'
import { createPaddleClient, PADDLE_MAX_FILE_SIZE } from '../client'

/** Capability handler that extracts text from images via PaddleOCR. */
export const paddleImageToTextHandler: FileProcessingCapabilityHandler<'image_to_text'> = {
  mode: 'background',
  /** Validates inputs and returns a background executor that calls the OCR API. */
  async prepare(file, config, signal) {
    signal?.throwIfAborted()
    const { apiHost, apiKey, model } = await prepareContext(file, config, signal)

    return {
      mode: 'background',
      async execute(executionContext) {
        const client = await createPaddleClient(apiHost, apiKey)
        const result = await client.ocr({ filePath: file.path, model }, { signal: executionContext.signal })
        const text = result.pages
          .flatMap((p) => {
            const recTexts = (p.prunedResult as { rec_texts?: unknown })?.rec_texts
            return Array.isArray(recTexts) ? recTexts.filter((value): value is string => typeof value === 'string') : []
          })
          .join('\n')
          .trim()

        if (!text) {
          throw new Error('PaddleOCR image OCR returned empty text content')
        }

        return { kind: 'text', text }
      }
    }
  }
}

/** Extracts API credentials and model from config for image OCR. */
async function prepareContext(file: FileInfo, config: FileProcessorMerged, signal?: AbortSignal) {
  signal?.throwIfAborted()
  const capability = getRequiredCapability(config, 'image_to_text', 'paddleocr')
  if (file.type !== FILE_TYPE.IMAGE) {
    throw new Error('PaddleOCR text extraction only supports image files')
  }

  const stat = await fs.stat(file.path)
  if (stat.size >= PADDLE_MAX_FILE_SIZE) {
    throw new Error('PaddleOCR file is too large (must be smaller than 50MB)')
  }

  return {
    apiHost: getRequiredApiHost(capability),
    apiKey: getRequiredApiKey(config, 'paddleocr'),
    model: capability.modelId?.trim() || undefined
  }
}
