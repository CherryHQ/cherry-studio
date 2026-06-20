import type { ProcessingStatus } from '@types'

export interface CodeToolsRunResult {
  success: boolean
  message: string
  command: string
}

export type OperationResult = { success: true } | { success: false; message: string }

export type LoaderReturn = {
  entriesAdded: number
  uniqueId: string
  uniqueIds: string[]
  loaderType: string
  status?: ProcessingStatus
  message?: string
  messageSource?: 'preprocess' | 'embedding' | 'validation'
}
