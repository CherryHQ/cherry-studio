import type { FileMetadata } from '@types'

export type PreparedOpenMineruContext = {
  apiHost: string
  apiKey?: string
  signal?: AbortSignal
  file: FileMetadata
}

export type OpenMineruTaskState = {
  status: 'processing' | 'completed' | 'failed'
  progress: number
  markdownPath?: string
  error?: string
}
