import type { FileInfo } from '@shared/types/file'
import * as z from 'zod'

export const SystemOcrOptionsSchema = z.looseObject({
  langs: z.array(z.string()).optional()
})

export type PreparedSystemOcrContext = {
  file: FileInfo
  signal?: AbortSignal
  langs?: string[]
}
