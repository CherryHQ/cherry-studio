import { FileMetadata, PreprocessProvider } from '@types'

import BasePreprocessProvider from './BasePreprocessProvider'

export default class DefaultPreprocessProvider extends BasePreprocessProvider {
  constructor(provider: PreprocessProvider) {
    super(provider)
  }
  public parseFile(): Promise<{ processedFile: FileMetadata }> {
    throw new Error('Method not implemented.')
  }

  public checkQuota(): Promise<number> {
    throw new Error('Method not implemented.')
  }
}
