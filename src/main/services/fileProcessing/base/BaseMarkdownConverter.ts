/**
 * Base Markdown Converter
 *
 * Abstract base class for markdown conversion processors.
 * Uses the Template Method pattern to define a consistent processing pipeline.
 */

import { getTempDir } from '@main/utils/file'
import type { FileProcessorMerged } from '@shared/data/presets/fileProcessing'
import type { ProcessingResult } from '@shared/data/types/fileProcessing'
import type { FileMetadata } from '@types'
import * as fs from 'fs'
import * as path from 'path'

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
   * Get the API host from configuration
   *
   * After merging, capability.apiHost contains the effective value
   * (template default overridden by user config if present)
   */
  protected getApiHost(config: FileProcessorMerged, defaultHost?: string): string {
    const capability = config.capabilities.find((cap) => cap.feature === 'markdown_conversion')
    if (capability?.apiHost) {
      return capability.apiHost
    }

    if (defaultHost) {
      return defaultHost
    }

    throw new Error(`API host is required for ${this.id} processor`)
  }

  /**
   * Get the API key from configuration
   */
  protected getApiKey(config: FileProcessorMerged, required = true): string | undefined {
    if (required && !config.apiKey) {
      throw new Error(`API key is required for ${this.id} processor`)
    }
    return config.apiKey
  }

  /**
   * Convert the input document to markdown
   */
  async convertToMarkdown(
    input: FileMetadata,
    config: FileProcessorMerged,
    context: ProcessingContext
  ): Promise<ProcessingResult> {
    this.checkCancellation(context)
    this.validateDocument(input)
    return this.doConvert(input, config, context)
  }

  /**
   * Validate the input document
   */
  protected validateDocument(input: FileMetadata): void {
    if (!input.path) {
      throw new Error('Document file path is required')
    }
  }

  /**
   * Perform the actual markdown conversion (subclass implementation)
   */
  protected abstract doConvert(
    input: FileMetadata,
    config: FileProcessorMerged,
    context: ProcessingContext
  ): Promise<ProcessingResult>
}
