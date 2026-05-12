import type { FileMetadata } from '@types'

export type PreparedOpenMineruContext = {
  apiHost: string
  apiKey?: string
  file: FileMetadata
  signal?: AbortSignal
}

export type OpenMineruTaskState =
  | {
      status: 'processing'
      progress: number
    }
  | {
      status: 'completed'
      progress: 100
      markdownPath: string
    }
  | {
      status: 'failed'
      progress: number
      error?: string
    }
