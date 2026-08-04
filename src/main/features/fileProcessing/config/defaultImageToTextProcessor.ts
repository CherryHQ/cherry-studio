import { isMac, isWin } from '@main/core/platform'
import type { FileProcessorId } from '@shared/data/preference/preferenceTypes'

export function resolveDefaultImageToTextProcessor(): FileProcessorId {
  return isMac || isWin ? 'system' : 'tesseract'
}
