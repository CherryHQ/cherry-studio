import type { ImageFileMetadata } from '@types'

export type PreparedOvOcrContext = {
  file: ImageFileMetadata
  signal?: AbortSignal
  workingDirectoryPrefix: string
}
