import { FileType, OcrProvider as Provider } from '@types'

import BaseOcrProvider from './BaseOcrProvider'
import OcrProviderFactory from './OcrProviderFactory'

export default class OcrProvider {
  private sdk: BaseOcrProvider
  constructor(provider: Provider) {
    this.sdk = OcrProviderFactory.create(provider)
  }
  public async parseFile(sourceId: string, file: FileType): Promise<{ processedFile: FileType }> {
    return this.sdk.parseFile(sourceId, file)
  }
}
