/**
 * System OCR Processor
 *
 * Uses the native system OCR capabilities via @napi-rs/system-ocr.
 * Available on macOS and Windows only (not Linux).
 */

import { loggerService } from '@logger'
import { isLinux, isWin } from '@main/constant'
import { loadOcrImage } from '@main/utils/ocr'
import { OcrAccuracy, recognize } from '@napi-rs/system-ocr'
import { type FileProcessorMerged, PRESETS_FILE_PROCESSORS } from '@shared/data/presets/fileProcessing'
import type { ProcessingResult } from '@shared/data/types/fileProcessing'
import type { FileMetadata } from '@types'
import { isImageFileMetadata } from '@types'

import { BaseTextExtractor } from '../../base/BaseTextExtractor'
import type { ProcessingContext } from '../../types'

const logger = loggerService.withContext('SystemOcrProcessor')

/**
 * System OCR processor
 *
 * Leverages native platform OCR capabilities:
 * - macOS: Vision framework
 * - Windows: Windows.Media.Ocr
 * - Linux: Not supported
 */
export class SystemOcrProcessor extends BaseTextExtractor {
  constructor() {
    const template = PRESETS_FILE_PROCESSORS.find((p) => p.id === 'system')
    if (!template) {
      throw new Error('System OCR processor template not found in presets')
    }
    super(template)
  }

  /**
   * Check if the processor is available on this platform
   *
   * System OCR is only available on macOS and Windows.
   */
  async isAvailable(): Promise<boolean> {
    return !isLinux
  }

  /**
   * Parse language configuration from processor options
   *
   * Language configuration is only supported on Windows.
   */
  private parseLangs(config: FileProcessorMerged): string[] | undefined {
    if (!isWin) {
      // macOS doesn't support language specification
      return undefined
    }

    const langsOption = config.options?.langs

    if (typeof langsOption === 'string') {
      return [langsOption]
    }

    if (Array.isArray(langsOption) && langsOption.length > 0) {
      return langsOption as string[]
    }

    return undefined
  }

  /**
   * Perform text extraction using system OCR
   */
  protected async doExtractText(
    input: FileMetadata,
    config: FileProcessorMerged,
    context: ProcessingContext
  ): Promise<ProcessingResult> {
    if (!isImageFileMetadata(input)) {
      throw new Error('SystemOcrProcessor only supports image files')
    }

    if (isLinux) {
      throw new Error('System OCR is not available on Linux')
    }

    this.checkCancellation(context)

    logger.debug('Processing file', { path: input.path })

    // Load and preprocess image
    const buffer = await loadOcrImage(input)

    // Get language configuration (Windows only)
    const langs = this.parseLangs(config)

    // Perform recognition
    const result = await recognize(buffer, OcrAccuracy.Accurate, langs)

    return { text: result.text }
  }
}
