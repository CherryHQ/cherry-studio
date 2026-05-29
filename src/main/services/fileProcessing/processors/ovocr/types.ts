import type { FileInfo } from '@shared/file/types'

export type PreparedOvOcrContext = {
  file: FileInfo
  signal?: AbortSignal
  workingDirectoryPrefix: string
}
