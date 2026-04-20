import type { ImageFileMetadata } from '@types'
import type { LanguageCode } from 'tesseract.js'
import * as z from 'zod'

export const TesseractProcessorOptionsSchema = z.looseObject({
  langs: z.array(z.string()).optional()
})

export type PreparedTesseractContext = {
  file: ImageFileMetadata
  signal?: AbortSignal
  langs: LanguageCode[]
}
