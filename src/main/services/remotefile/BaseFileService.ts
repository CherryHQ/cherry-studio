import { FileListResponse, FileMetadata, FileUploadResponse, Provider } from '@types'

export abstract class BaseFileService {
  protected readonly provider: Provider
  protected constructor(provider: Provider) {
    this.provider = provider
  }

  abstract uploadFile(file: FileMetadata): Promise<FileUploadResponse>
  abstract deleteFile(fileId: string): Promise<void>
  abstract listFiles(): Promise<FileListResponse>
  abstract retrieveFile(fileId: string): Promise<FileUploadResponse>
}
