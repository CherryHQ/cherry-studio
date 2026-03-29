import type { FileProcessorMerged } from '@shared/data/presets/file-processing'
import type {
  FileProcessingMarkdownTaskResult,
  FileProcessingMarkdownTaskStartResult
} from '@shared/data/types/fileProcessing'
import type { FileMetadata } from '@types'

import type { ITextExtractionProcessor } from '../../interfaces'
import type { FileProcessingTextExtractionResult } from '../../types'
import { BaseMarkdownConversionProcessor } from '../base/BaseFileProcessor'

export class PaddleProcessor extends BaseMarkdownConversionProcessor implements ITextExtractionProcessor {
  constructor() {
    super('paddleocr')
  }

  async extractText(
    file: FileMetadata,
    config: FileProcessorMerged,
    signal?: AbortSignal
  ): Promise<FileProcessingTextExtractionResult> {
    void file
    void config
    void signal
    throw new Error('PaddleProcessor.extractText is not implemented')
  }

  async startMarkdownConversionTask(
    file: FileMetadata,
    config: FileProcessorMerged,
    signal?: AbortSignal
  ): Promise<FileProcessingMarkdownTaskStartResult> {
    void file
    void config
    void signal
    throw new Error('PaddleProcessor.startMarkdownConversionTask is not implemented')
  }

  async getMarkdownConversionTaskResult(
    providerTaskId: string,
    config: FileProcessorMerged,
    signal?: AbortSignal
  ): Promise<FileProcessingMarkdownTaskResult> {
    void providerTaskId
    void config
    void signal
    throw new Error('PaddleProcessor.getMarkdownConversionTaskResult is not implemented')
  }

  protected async persistMarkdownConversionResult(providerTaskId: string, downloadUrl: string): Promise<string> {
    void providerTaskId
    void downloadUrl
    throw new Error('PaddleProcessor.persistMarkdownConversionResult is not implemented')
  }
}
