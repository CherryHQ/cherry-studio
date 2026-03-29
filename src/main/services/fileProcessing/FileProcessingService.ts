import { loggerService } from '@logger'
import { application } from '@main/core/application'
import type { FileProcessorFeature, FileProcessorId } from '@shared/data/preference/preferenceTypes'
import type { FileProcessorMerged } from '@shared/data/presets/file-processing'

import { createMarkdownConversionProcessor, createTextExtractionProcessor } from './providers/factory'
import type {
  ExtractTextInput,
  FileProcessingMarkdownTaskResult,
  FileProcessingMarkdownTaskStartResult,
  FileProcessingTextExtractionResult,
  GetMarkdownConversionTaskResultInput,
  StartMarkdownConversionTaskInput
} from './types'
import { resolveProcessorConfig } from './utils/config'

const logger = loggerService.withContext('FileProcessingService')

export class FileProcessingService {
  async extractText(input: ExtractTextInput): Promise<FileProcessingTextExtractionResult> {
    const resolvedConfig = await this.resolveProcessorConfig('text_extraction', input.processorId)
    const processor = createTextExtractionProcessor(resolvedConfig.id)

    logger.debug('Extracting text with file-processing service', {
      processorId: resolvedConfig.id,
      fileId: input.file.id
    })

    const result = await processor.extractText(input.file, resolvedConfig, input.signal)

    return result
  }

  async startMarkdownConversionTask(
    input: StartMarkdownConversionTaskInput
  ): Promise<FileProcessingMarkdownTaskStartResult> {
    const resolvedConfig = await this.resolveProcessorConfig('markdown_conversion', input.processorId)
    const processor = createMarkdownConversionProcessor(resolvedConfig.id)

    logger.debug('Starting markdown conversion task with file-processing service', {
      processorId: resolvedConfig.id,
      fileId: input.file.id
    })

    const task = await processor.startMarkdownConversionTask(input.file, resolvedConfig, input.signal)

    return task
  }

  async getMarkdownConversionTaskResult(
    input: GetMarkdownConversionTaskResultInput
  ): Promise<FileProcessingMarkdownTaskResult> {
    const processor = createMarkdownConversionProcessor(input.processorId)

    logger.debug('Getting markdown conversion task result with file-processing service', {
      processorId: input.processorId,
      providerTaskId: input.providerTaskId
    })

    return processor.getMarkdownConversionTaskResult(input.providerTaskId, input.signal)
  }

  private async resolveProcessorConfig(
    feature: FileProcessorFeature,
    processorId?: FileProcessorId
  ): Promise<FileProcessorMerged> {
    return resolveProcessorConfig(
      {
        feature,
        processorId
      },
      application.get('PreferenceService')
    )
  }
}

export const fileProcessingService = new FileProcessingService()
