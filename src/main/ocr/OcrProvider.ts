import { FileType, KnowledgeBaseParams } from '@types'

import BaseOcrProvider from './BaseOcrProvider'
import OcrProviderFactory from './OcrProviderFactory'

export default class OcrProvider {
  private sdk: BaseOcrProvider
  constructor(base: KnowledgeBaseParams) {
    this.sdk = OcrProviderFactory.create(base)
  }
  public async parseFile(sourceId: string, file: FileType): Promise<{ processedFile: FileType }> {
    return this.sdk.parseFile(sourceId, file)
  }
}
