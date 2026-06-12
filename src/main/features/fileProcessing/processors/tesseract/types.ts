import type { FileInfo } from '@shared/file/types'
import type { LanguageCode } from 'tesseract.js'
import * as z from 'zod'

export const TesseractProcessorOptionsSchema = z.looseObject({
  langs: z.array(z.string()).optional()
})

export type PreparedTesseractContext = {
  file: FileInfo
  signal?: AbortSignal
  langs: LanguageCode[]
}
