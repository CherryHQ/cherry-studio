import type { FileProcessorId } from '@shared/data/preference/preferenceTypes'

export function resolveDefaultImageToTextProcessor(platform: NodeJS.Platform = process.platform): FileProcessorId {
  if (platform === 'darwin' || platform === 'win32') {
    return 'system'
  }

  return 'tesseract'
}
