import type { ProcessingStatus } from '@types'

export type LoaderReturn = {
  entriesAdded: number
  uniqueId: string
  uniqueIds: string[]
  loaderType: string
  status?: ProcessingStatus
  message?: string
  messageSource?: 'preprocess' | 'embedding' | 'validation'
}

export type FileChangeEventType = 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir' | 'refresh'

export type FileChangeEvent = {
  eventType: FileChangeEventType
  filePath: string
  watchPath: string
}

export type MCPProgressEvent = {
  callId: string
  progress: number // 0-1 range
}

export type MCPServerLogEntry = {
  timestamp: number
  level: 'debug' | 'info' | 'warn' | 'error' | 'stderr' | 'stdout'
  message: string
  data?: any
  source?: string
}

export type WebviewKeyEvent = {
  webviewId: number
  key: string
  control: boolean
  meta: boolean
  shift: boolean
  alt: boolean
}

export interface WebSocketStatusResponse {
  isRunning: boolean
  port?: number
  ip?: string
  clientConnected: boolean
}

export interface WebSocketCandidatesResponse {
  host: string
  interface: string
  priority: number
}
