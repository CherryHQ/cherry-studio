import { ProcessingStatus } from '@types'

export type LoaderReturn = {
  entriesAdded: number
  uniqueId: string
  uniqueIds: string[]
  loaderType: string
  status?: ProcessingStatus
  message?: string
  messageSource?: 'preprocess' | 'embedding' | 'validation'
}

export type FileChangeEventType = 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir'

export type FileChangeEvent = {
  eventType: FileChangeEventType
  filePath: string
  watchPath: string
}

export type MCPProgressEvent = {
  callId: string
  progress: number // 0-1 range
}
