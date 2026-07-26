import type { FileInfo } from '@shared/types/file'

export type PreparedOpenMineruContext = {
  apiHost: string
  apiKey?: string
  file: FileInfo
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
