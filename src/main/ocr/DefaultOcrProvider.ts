import { FileMetadata, OcrProvider } from '@types'

import BaseOcrProvider from './BaseOcrProvider'

export default class DefaultOcrProvider extends BaseOcrProvider {
  constructor(provider: OcrProvider) {
    super(provider)
  }
  public parseFile(): Promise<{ processedFile: FileMetadata }> {
    throw new Error('Method not implemented.')
  }
}
