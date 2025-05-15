import { FileListResponse, FileUploadResponse, LocalFileSource } from '@types'

export abstract class BaseFileService {
  protected readonly apiKey: string
  protected constructor(apiKey: string) {
    this.apiKey = apiKey
  }

  abstract uploadFile(file: LocalFileSource): Promise<FileUploadResponse>
  abstract deleteFile(fileId: string): Promise<void>
  abstract listFiles(): Promise<FileListResponse>
  abstract retrieveFile(fileId: string): Promise<FileUploadResponse>
}
