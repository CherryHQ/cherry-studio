import type { FileInfo } from '@shared/file/types'

export type PaddleRemoteContext = {
  apiHost: string
  apiKey: string
}

export type PreparedPaddleStartContext = PaddleRemoteContext & {
  file: FileInfo
  taskId: string
  model?: string
}
