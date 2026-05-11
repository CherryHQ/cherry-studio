import type { FileProcessingCapabilityHandler } from '../../types'
import { executeExtraction, prepareContext } from '../utils'

export const ovocrImageToTextHandler: FileProcessingCapabilityHandler<'image_to_text'> = {
  prepare(file, config, signal) {
    const context = prepareContext(file, config, signal)

    return {
      mode: 'background',
      execute(executionContext) {
        return executeExtraction({
          ...context,
          signal: executionContext.signal
        })
      }
    }
  }
}
