import { FileType, KnowledgeBaseParams } from '@types'

import BaseOcrProvider from './BaseOcrProvider'

export default class DefaultOcrProvider extends BaseOcrProvider {
  constructor(base: KnowledgeBaseParams) {
    super(base)
  }
  public parseFile(): Promise<{ processedFile: FileType }> {
    throw new Error('Method not implemented.')
  }
}
