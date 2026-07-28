import type { FileInfo } from '@shared/types/file'

export type PreparedOvOcrContext = {
  file: FileInfo
  signal?: AbortSignal
  workingDirectoryPrefix: string
}
