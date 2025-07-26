import { loggerService } from '@logger'
import { isMac } from '@main/constant'
import { OcrProvider } from '@types'

import BaseOcrProvider from './BaseOcrProvider'
import DefaultOcrProvider from './DefaultOcrProvider'
import MacSysOcrProvider from './MacSysOcrProvider'

const logger = loggerService.withContext('OcrProviderFactory')

export default class OcrProviderFactory {
  static create(provider: OcrProvider): BaseOcrProvider {
    switch (provider.id) {
      case 'system':
        if (!isMac) {
          logger.warn('System OCR provider is only available on macOS')
        }
        return new MacSysOcrProvider(provider)
      default:
        return new DefaultOcrProvider(provider)
    }
  }
}
