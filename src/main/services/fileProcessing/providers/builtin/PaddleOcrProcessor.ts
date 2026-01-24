/**
 * PaddleOCR Processor
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

const logger = loggerService.withContext('PaddleOcrProcessor')

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
 * PaddleOCR processor
 *
 * Sends images to a PaddleOCR API endpoint for text extraction.
 */
export class PaddleOcrProcessor extends BaseTextExtractor {
  constructor() {
    const template = PRESETS_FILE_PROCESSORS.find((p) => p.id === 'paddleocr')
    if (!template) {
      throw new Error('PaddleOCR processor template not found in presets')
    }
    super(template)
  }

  /**
   * Get the API URL from configuration
   *
   * Priority:
   * 1. featureConfigs[].apiHost (user override)
   * 2. capabilities[].defaultApiHost (template default)
   */
  private getApiUrl(config: FileProcessorMerged): string {
    // Check user override in featureConfigs
    const featureConfig = config.featureConfigs?.find((fc) => fc.feature === 'text_extraction')
    if (featureConfig?.apiHost) {
      return featureConfig.apiHost
    }

    // Check template default
    const capability = config.capabilities.find((cap) => cap.feature === 'text_extraction')
    if (capability?.defaultApiHost) {
      return capability.defaultApiHost
    }

    throw new Error('API URL is required for PaddleOCR processor')
  }

  /**
   * Get the API key from configuration (optional)
   */
  private getApiKey(config: FileProcessorMerged): string | undefined {
    return config.apiKey
  }

  /**
   * Perform text extraction using PaddleOCR API
   */
  protected async doExtractText(
    input: FileMetadata,
    config: FileProcessorMerged,
    _context: ProcessingContext
  ): Promise<ProcessingResult> {
    if (!isImageFileMetadata(input)) {
      throw new Error('PaddleOcrProcessor only supports image files')
    }

    const apiUrl = this.getApiUrl(config)
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
      logger.error('Error during PaddleOCR process', { error })
      throw error
    }
  }
}
