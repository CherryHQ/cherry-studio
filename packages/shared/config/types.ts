import { ProcessingStatus } from '@types'

export type LoaderReturn = {
  entriesAdded: number
  uniqueId: string
  uniqueIds: string[]
  loaderType: string
  status?: ProcessingStatus
  message?: string
  messageSource?: 'preprocess' | 'embedding'
}

export type LogSourceWithContext = {
  process: 'main' | 'renderer'
  window?: string // only for renderer process
  module?: string
  context?: Record<string, any>
}

export type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'verbose' | 'silly'
