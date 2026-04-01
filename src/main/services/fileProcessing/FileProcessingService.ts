import fs from 'node:fs/promises'
import path from 'node:path'

import { loggerService } from '@logger'
import { getFilesDir } from '@main/utils/file'
import type { FileProcessorId } from '@shared/data/preference/preferenceTypes'
import type { FileMetadata } from '@types'

import { createMarkdownConversionProcessor, createTextExtractionProcessor } from './providers/factory'
import type {
  FileProcessingMarkdownTaskResult,
  FileProcessingMarkdownTaskStartResult,
  FileProcessingTextExtractionResult
} from './types'
import { resolveProcessorConfig } from './utils/config'
import { OUTPUT_MARKDOWN_FILE } from './utils/resultPersistence'

const logger = loggerService.withContext('FileProcessingService')

export class FileProcessingService {
  async extractText(
    file: FileMetadata,
    processorId?: FileProcessorId,
    signal?: AbortSignal
  ): Promise<FileProcessingTextExtractionResult> {
    const resolvedConfig = await resolveProcessorConfig('text_extraction', processorId)
    const processor = createTextExtractionProcessor(resolvedConfig.id)

    logger.debug('Extracting text with file-processing service', {
      processorId: resolvedConfig.id,
      fileId: file.id
    })

    const result = await processor.extractText(file, resolvedConfig, signal)

    return result
  }

  async startMarkdownConversionTask(
    file: FileMetadata,
    processorId?: FileProcessorId,
    signal?: AbortSignal
  ): Promise<FileProcessingMarkdownTaskStartResult> {
    const resolvedConfig = await resolveProcessorConfig('markdown_conversion', processorId)
    const processor = createMarkdownConversionProcessor(resolvedConfig.id)

    logger.debug('Starting markdown conversion task with file-processing service', {
      processorId: resolvedConfig.id,
      fileId: file.id
    })

    return await processor.startMarkdownConversionTask(file, resolvedConfig, signal)
  }

  async getMarkdownConversionTaskResult(
    providerTaskId: string,
    processorId: FileProcessorId,
    signal?: AbortSignal
  ): Promise<FileProcessingMarkdownTaskResult> {
    const processor = createMarkdownConversionProcessor(processorId)

    logger.debug('Getting markdown conversion task result with file-processing service', {
      processorId: processorId,
      providerTaskId: providerTaskId
    })

    return await processor.getMarkdownConversionTaskResult(providerTaskId, signal)
  }

  async getPersistedMarkdownResult(fileId: string): Promise<string | undefined> {
    // TODO(file-processing): Move this derived-file path lookup into the unified
    // FileSystem/FileManager once that layer lands.
    const markdownPath = path.join(getFilesDir(), fileId, 'file-processing', OUTPUT_MARKDOWN_FILE)
    const exists = await fs
      .access(markdownPath)
      .then(() => true)
      .catch(() => false)

    return exists ? markdownPath : undefined
  }
}

export const fileProcessingService = new FileProcessingService()
