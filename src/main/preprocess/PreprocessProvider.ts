import { FileMetadata, PreprocessProvider as Provider } from '@types'

import BasePreprocessProvider from './BasePreprocessProvider'
import PreprocessProviderFactory from './PreprocessProviderFactory'

export default class PreprocessProvider {
  private sdk: BasePreprocessProvider
  constructor(provider: Provider, userId?: string) {
    this.sdk = PreprocessProviderFactory.create(provider, userId)
  }
  public async parseFile(
    sourceId: string,
    file: FileMetadata
  ): Promise<{ processedFile: FileMetadata; quota?: number }> {
    return this.sdk.parseFile(sourceId, file)
  }

  public async checkQuota(): Promise<number> {
    return this.sdk.checkQuota()
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
