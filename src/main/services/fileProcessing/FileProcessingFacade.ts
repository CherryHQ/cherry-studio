import path from 'node:path'

import { loggerService } from '@logger'
import { pathExists } from '@main/utils/file'
import type { FileProcessorId } from '@shared/data/preference/preferenceTypes'
import type { FileMetadata } from '@types'

import { getFileProcessingResultsDir } from './providers/base/BaseFileProcessor'
import { createMarkdownConversionProcessor, createTextExtractionProcessor } from './providers/factory'
import type {
  FileProcessingMarkdownTaskResult,
  FileProcessingMarkdownTaskStartResult,
  FileProcessingTextExtractionResult
} from './types'
import { resolveProcessorConfig } from './utils/config'
import { OUTPUT_MARKDOWN_FILE } from './utils/resultPersistence'

const logger = loggerService.withContext('FileProcessingFacade')

export class FileProcessingFacade {
  async extractText(
    file: FileMetadata,
    processorId?: FileProcessorId,
    signal?: AbortSignal
  ): Promise<FileProcessingTextExtractionResult> {
    const resolvedConfig = await resolveProcessorConfig('text_extraction', processorId)
    const processor = createTextExtractionProcessor(resolvedConfig.id)

    logger.debug('Extracting text with file-processing facade', {
      processorId: resolvedConfig.id,
      fileId: file.id
    })

    return await processor.extractText(file, resolvedConfig, signal)
  }

  async startMarkdownConversionTask(
    file: FileMetadata,
    processorId?: FileProcessorId,
    signal?: AbortSignal
  ): Promise<FileProcessingMarkdownTaskStartResult> {
    const resolvedConfig = await resolveProcessorConfig('markdown_conversion', processorId)
    const processor = createMarkdownConversionProcessor(resolvedConfig.id)

    logger.debug('Starting markdown conversion task with file-processing facade', {
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

    logger.debug('Getting markdown conversion task result with file-processing facade', {
      processorId,
      providerTaskId
    })

    return await processor.getMarkdownConversionTaskResult(providerTaskId, signal)
  }

  async getPersistedMarkdownResult(fileId: string): Promise<string | undefined> {
    const markdownPath = path.join(getFileProcessingResultsDir(fileId), OUTPUT_MARKDOWN_FILE)
    const exists = await pathExists(markdownPath)

    return exists ? markdownPath : undefined
  }
}

export const fileProcessingFacade = new FileProcessingFacade()
