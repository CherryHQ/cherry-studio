import { ProcessingStatus } from '@cherry-types/common'

export type LoaderReturn = {
  entriesAdded: number
  uniqueId: string
  uniqueIds: string[]
  loaderType: string
  status?: ProcessingStatus
  message?: string
  messageSource?: 'preprocess' | 'embedding'
}
