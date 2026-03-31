import { loggerService } from '@logger'
import type { FileProcessorId } from '@shared/data/preference/preferenceTypes'
import type { FileMetadata } from '@types'

import { createMarkdownConversionProcessor, createTextExtractionProcessor } from './providers/factory'
import type {
  FileProcessingMarkdownTaskResult,
  FileProcessingMarkdownTaskStartResult,
  FileProcessingTextExtractionResult
} from './types'
import { resolveProcessorConfig } from './utils/config'

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
}

export const fileProcessingService = new FileProcessingService()
