import type { ImageFileMetadata } from '@types'
import * as z from 'zod'

export const SystemOcrOptionsSchema = z.looseObject({
  langs: z.array(z.string()).optional()
})

export type PreparedSystemOcrContext = {
  file: ImageFileMetadata
  signal?: AbortSignal
  langs?: string[]
}
