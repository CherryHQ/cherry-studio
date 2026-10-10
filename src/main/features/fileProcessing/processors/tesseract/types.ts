import type { LanguageCode } from 'tesseract.js'
import * as z from 'zod'

import type { FileInfo } from '@shared/types/file'

export const TesseractProcessorOptionsSchema = z.looseObject({
  langs: z.array(z.string()).optional()
})

export type PreparedTesseractContext = {
  file: FileInfo
  signal?: AbortSignal
  langs: LanguageCode[]
}
