import type { FileProcessorMerged } from '@shared/data/presets/file-processing'
import type {
  FileProcessingMarkdownTaskResult,
  FileProcessingMarkdownTaskStartResult
} from '@shared/data/types/fileProcessing'
import type { FileMetadata } from '@types'

import { BaseMarkdownConversionProcessor } from '../base/BaseFileProcessor'

export class OpenMineruProcessor extends BaseMarkdownConversionProcessor {
  constructor() {
    super('open-mineru')
  }

  async startMarkdownConversionTask(
    file: FileMetadata,
    config: FileProcessorMerged,
    signal?: AbortSignal
  ): Promise<FileProcessingMarkdownTaskStartResult> {
    void file
    void config
    void signal
    throw new Error('OpenMineruProcessor.startMarkdownConversionTask is not implemented')
  }

  async getMarkdownConversionTaskResult(
    providerTaskId: string,
    config: FileProcessorMerged,
    signal?: AbortSignal
  ): Promise<FileProcessingMarkdownTaskResult> {
    void providerTaskId
    void config
    void signal
    throw new Error('OpenMineruProcessor.getMarkdownConversionTaskResult is not implemented')
  }

  protected async persistMarkdownConversionResult(providerTaskId: string, downloadUrl: string): Promise<string> {
    void providerTaskId
    void downloadUrl
    throw new Error('OpenMineruProcessor.persistMarkdownConversionResult is not implemented')
  }
}
