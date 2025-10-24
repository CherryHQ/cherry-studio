import type { OcrApiProvider, OcrApiProviderConfig, SupportedOcrFile } from '@renderer/types'

import { OcrBaseApiClient } from './OcrBaseApiClient'

export type OcrExampleProvider = OcrApiProvider

// Not being used for now.
// TODO: Migrate to main in the future.
export class OcrExampleApiClient extends OcrBaseApiClient {
  constructor(provider: OcrApiProvider, config: OcrApiProviderConfig) {
    super(provider, config)
  }

  public ocr = async (file: SupportedOcrFile) => {
    return { text: `Example output: ${file.path}` }
  }
}
