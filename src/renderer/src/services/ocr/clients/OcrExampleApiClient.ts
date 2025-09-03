import { OcrApiProvider, SupportedOcrFile } from '@renderer/types'

import { OcrBaseApiClient } from './OcrBaseApiClient'

export type OcrExampleProvider = OcrApiProvider

export class OcrExampleApiClient extends OcrBaseApiClient {
  constructor(provider: OcrApiProvider) {
    super(provider)
  }

  public ocr = async (file: SupportedOcrFile) => {
    return { text: `Example output: ${file.path}` }
  }
}
