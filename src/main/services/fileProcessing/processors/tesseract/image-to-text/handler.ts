import { application } from '@application'

import type { FileProcessingCapabilityHandler } from '../../types'
import type { PreparedTesseractContext } from '../types'
import { prepareContext } from './prepare'

export const tesseractImageToTextHandler: FileProcessingCapabilityHandler<'image_to_text'> = {
  prepare(file, config, signal) {
    const context: PreparedTesseractContext = prepareContext(file, config, signal)

    return {
      mode: 'background',
      execute(executionContext) {
        return application.get('TesseractRuntimeService').extract({
          ...context,
          signal: executionContext.signal
        })
      }
    }
  }
}
