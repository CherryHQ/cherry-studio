import type { FileListResponse, FileUploadResponse } from '@main/services/remotefile/types'
import type { FileMetadata } from '@shared/data/types/file/legacyFileMetadata'

export abstract class BaseFileService {
  protected readonly apiKey: string
  protected readonly apiHost: string | undefined

  protected constructor(apiKey: string, apiHost: string | undefined) {
    this.apiKey = apiKey
    this.apiHost = apiHost
  }

  abstract uploadFile(file: FileMetadata): Promise<FileUploadResponse>
  abstract deleteFile(fileId: string): Promise<void>
  abstract listFiles(): Promise<FileListResponse>
  abstract retrieveFile(fileId: string): Promise<FileUploadResponse>
}
