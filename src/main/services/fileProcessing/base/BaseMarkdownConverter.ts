/**
 * Base Markdown Converter
 *
 * Abstract base class for markdown conversion processors.
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
 *
 * File size and page count validation is delegated to API providers.
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
