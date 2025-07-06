import { FileMetadata, OcrProvider as Provider } from '@types'

import BaseOcrProvider from './BaseOcrProvider'
import OcrProviderFactory from './OcrProviderFactory'

export default class OcrProvider {
  private sdk: BaseOcrProvider
  constructor(provider: Provider) {
    this.sdk = OcrProviderFactory.create(provider)
  }
  public async parseFile(
    sourceId: string,
    file: FileMetadata
  ): Promise<{ processedFile: FileMetadata; quota?: number }> {
    return this.sdk.parseFile(sourceId, file)
  }

  /**
   * 检查文件是否已经被预处理过
   * @param file 文件信息
   * @returns 如果已处理返回处理后的文件信息，否则返回null
   */
  public async checkIfAlreadyProcessed(file: FileMetadata): Promise<FileMetadata | null> {
    return this.sdk.checkIfAlreadyProcessed(file)
  }
}
