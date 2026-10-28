import * as z from 'zod'

import type { FileInfo } from '@shared/types/file'

export const SystemOcrOptionsSchema = z.looseObject({
  langs: z.array(z.string()).optional()
})

export type PreparedSystemOcrContext = {
  file: FileInfo
  signal?: AbortSignal
  langs?: string[]
}
