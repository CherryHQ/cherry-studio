/**
 * Base Markdown Converter
 *
 * Abstract base class for markdown conversion processors.
 */

import { loggerService } from '@logger'
import { getTempDir } from '@main/utils/file'
import type { FileProcessorMerged } from '@shared/data/presets/fileProcessing'
import type { ProcessingResult } from '@shared/data/types/fileProcessing'
import type { FileMetadata } from '@types'
import * as fs from 'fs'
import * as path from 'path'
import { PDFDocument } from 'pdf-lib'

const logger = loggerService.withContext('BaseMarkdownConverter')

import type { IMarkdownConverter } from '../interfaces'
import type { ProcessingContext } from '../types'
import { BaseFileProcessor } from './BaseFileProcessor'

/**
 * Abstract base class for markdown conversion processors
 *
 * Provides common functionality for API-based document processors including:
 * - Storage directory management
 * - Configuration extraction (API host, API key)
 * - Document limit validation
 *
 * Subclasses must implement convertToMarkdown() with their specific conversion logic.
 */
export abstract class BaseMarkdownConverter extends BaseFileProcessor implements IMarkdownConverter {
  protected readonly storageDir: string

  constructor(template: ConstructorParameters<typeof BaseFileProcessor>[0]) {
    super(template)
    this.storageDir = path.join(getTempDir(), 'preprocess')
    this.ensureStorageDir()
  }

  private ensureStorageDir(): void {
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true })
    }
  }

  /**
   * Get document limits from template metadata
   */
  protected getDocumentLimits(): { maxFileSizeMb?: number; maxPageCount?: number } {
    return this.template.metadata ?? {}
  }

  /**
   * Validate file before processing
   *
   * Checks:
   * - File path exists (via super)
   * - File size against maxFileSizeMb limit
   * - Page count against maxPageCount limit (PDF only)
   *
   * Uses graceful degradation: if PDF parsing fails, logs warning and continues
   */
  protected async validateFile(file: FileMetadata): Promise<void> {
    super.validateFile(file)

    const filePath = file.path!
    const stats = await fs.promises.stat(filePath)
    const fileSizeBytes = stats.size
    const { maxFileSizeMb, maxPageCount } = this.getDocumentLimits()

    // File size check
    if (maxFileSizeMb !== undefined && fileSizeBytes > maxFileSizeMb * 1024 * 1024) {
      const fileSizeMB = Math.round(fileSizeBytes / (1024 * 1024))
      throw new Error(`File size (${fileSizeMB}MB) exceeds the limit of ${maxFileSizeMb}MB`)
    }

    // Page count check (PDF only)
    if (maxPageCount === undefined || file.ext?.toLowerCase() !== '.pdf') {
      return
    }

    try {
      const pdfBuffer = await fs.promises.readFile(filePath)
      const pdfDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true })
      const numPages = pdfDoc.getPageCount()

      if (numPages > maxPageCount) {
        throw new Error(`PDF page count (${numPages}) exceeds the limit of ${maxPageCount} pages`)
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      if (errorMessage.includes('exceeds the limit')) {
        throw error
      }
      logger.warn(`Failed to parse PDF structure, skipping page count validation: ${errorMessage}`)
    }
  }

  /**
   * Get the API host from configuration
   *
   * After merging, capability.apiHost contains the effective value
   * (template default overridden by user config if present)
   */
  protected getApiHost(config: FileProcessorMerged): string {
    const capability = config.capabilities.find((cap) => cap.feature === 'markdown_conversion')
    if (capability?.apiHost) {
      return capability.apiHost
    }

    throw new Error(`API host is required for ${this.id} processor`)
  }

  /**
   * Convert the input document to markdown
   */
  abstract convertToMarkdown(
    file: FileMetadata,
    config: FileProcessorMerged,
    context: ProcessingContext
  ): Promise<ProcessingResult>
}
