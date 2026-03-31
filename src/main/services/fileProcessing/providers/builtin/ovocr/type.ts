import type { ImageFileMetadata } from '@types'

export type PreparedOvOcrContext = {
  file: ImageFileMetadata
  signal?: AbortSignal
  workingDirectory: string
  imgDirectory: string
  outputDirectory: string
}
