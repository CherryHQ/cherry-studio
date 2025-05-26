import { FileType, OcrProvider } from '@types'

import BaseOcrProvider from './BaseOcrProvider'

export default class DefaultOcrProvider extends BaseOcrProvider {
  constructor(provider: OcrProvider) {
    super(provider)
  }
  public parseFile(): Promise<{ processedFile: FileType }> {
    throw new Error('Method not implemented.')
  }
}
