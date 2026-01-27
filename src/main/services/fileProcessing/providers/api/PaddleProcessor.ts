/**
 * Paddle Processor
 *
 * API-based OCR processor using PaddleOCR service.
 * Requires an API host to be configured.
 */

import { loggerService } from '@logger'
import { loadOcrImage } from '@main/utils/ocr'
import { type FileProcessorMerged, PRESETS_FILE_PROCESSORS } from '@shared/data/presets/fileProcessing'
import type { ProcessingResult } from '@shared/data/types/fileProcessing'
import type { FileMetadata } from '@types'
import { isImageFileMetadata } from '@types'
import { net } from 'electron'
import * as z from 'zod'

import { BaseTextExtractor } from '../../base/BaseTextExtractor'
import type { ProcessingContext } from '../../types'

const logger = loggerService.withContext('PaddleProcessor')

/**
 * File type for PaddleOCR API
 */
const FILE_TYPE_IMAGE = 1

/**
 * OCR request payload interface
 * API Reference: https://www.paddleocr.ai/latest/version3.x/pipeline_usage/OCR.html#3
 */
interface OcrPayload {
  file: string
  fileType?: number | null
  useDocOrientationClassify?: boolean | null
  useDocUnwarping?: boolean | null
  useTextlineOrientation?: boolean | null
  textDetLimitSideLen?: number | null
  textDetLimitType?: string | null
  textDetThresh?: number | null
  textDetBoxThresh?: number | null
  textDetUnclipRatio?: number | null
  textRecScoreThresh?: number | null
  visualize?: boolean | null
}

/**
 * Zod schema for validating OCR API response
 */
const OcrResponseSchema = z.object({
  result: z.object({
    ocrResults: z.array(
      z.object({
        prunedResult: z.object({
          rec_texts: z.array(z.string())
        })
      })
    )
  })
})

/**
 * Paddle processor
 *
 * Sends images to a PaddleOCR API endpoint for text extraction.
 */
export class PaddleProcessor extends BaseTextExtractor {
  constructor() {
    const template = PRESETS_FILE_PROCESSORS.find((p) => p.id === 'paddleocr')
    if (!template) {
      throw new Error('PaddleOCR processor template not found in presets')
    }
    super(template)
  }

  /**
   * Perform text extraction using PaddleOCR API
   */
  async extractText(
    input: FileMetadata,
    config: FileProcessorMerged,
    context: ProcessingContext
  ): Promise<ProcessingResult> {
    if (!isImageFileMetadata(input)) {
      throw new Error('PaddleProcessor only supports image files')
    }

    this.checkCancellation(context)

    const apiUrl = this.getApiHost(config)
    const apiKey = this.getApiKey(config)

    logger.debug('Using API URL', { apiUrl })

    // Load and preprocess image
    const buffer = await loadOcrImage(input)
    const base64 = buffer.toString('base64')

    // Prepare payload
    const payload: OcrPayload = {
      file: base64,
      fileType: FILE_TYPE_IMAGE,
      useDocOrientationClassify: false,
      useDocUnwarping: false,
      visualize: false
    }

    // Prepare headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    }

    if (apiKey) {
      headers['Authorization'] = `token ${apiKey}`
    }

    // Send request
    try {
      const response = await net.fetch(apiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      })

      if (!response.ok) {
        const text = await response.text()
        throw new Error(`OCR service error: ${response.status} ${response.statusText} - ${text}`)
      }

      const data = await response.json()

      // Validate response
      const validatedResponse = OcrResponseSchema.parse(data)
      const recTexts = validatedResponse.result.ocrResults[0]?.prunedResult.rec_texts ?? []

      return { text: recTexts.join('\n') }
    } catch (error) {
      logger.error('Error during PaddleProcessor process', { error })
      throw error
    }
  }
}
