import type { FileInfo } from '@shared/types/file'

export type OpenMineruConnection = {
  apiHost: string
  apiKey?: string
}

export type OpenMineruRemoteContext = OpenMineruConnection &
  ({ protocol: 'v1' } | { protocol: 'tasks'; providerFileId: string })

export type PreparedOpenMineruContext = OpenMineruConnection & {
  file: FileInfo
  signal?: AbortSignal
}

export type OpenMineruProbeResult =
  | { kind: 'supported'; protocol: 'legacy' | 'v1' | 'tasks' }
  | { kind: 'http-error'; status: number }
  | { kind: 'invalid-response' }
  | { kind: 'not-found' }
  | { kind: 'unreachable' }

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
