import { FileState, GoogleAIFileManager } from '@google/generative-ai/server'
import { FileListResponse, FileUploadResponse, LocalFileSource } from '@types'

import { CacheService } from '../CacheService'
import { BaseFileService } from './BaseFileService'

export class GeminiService extends BaseFileService {
  private static readonly FILE_LIST_CACHE_KEY = 'gemini_file_list'
  private static readonly FILE_CACHE_DURATION = 48 * 60 * 60 * 1000
  private static readonly LIST_CACHE_DURATION = 3000

  protected readonly fileManager: GoogleAIFileManager

  constructor(apiKey: string) {
    super(apiKey)
    this.fileManager = new GoogleAIFileManager(apiKey)
  }

  async uploadFile(file: LocalFileSource): Promise<FileUploadResponse> {
    const uploadResult = await this.fileManager.uploadFile(file.path, {
      mimeType: 'application/pdf',
      displayName: file.origin_name
    })

    // 根据文件状态设置响应状态
    let status: 'success' | 'processing' | 'failed' | 'unknown'
    switch (uploadResult.file.state) {
      case FileState.ACTIVE:
        status = 'success'
        break
      case FileState.PROCESSING:
        status = 'processing'
        break
      case FileState.FAILED:
        status = 'failed'
        break
      default:
        status = 'unknown'
    }

    const response: FileUploadResponse = {
      fileId: uploadResult.file.name || '',
      displayName: file.origin_name,
      status,
      originalFile: uploadResult
    }

    // 只缓存成功的文件
    if (status === 'success') {
      const cacheKey = `${GeminiService.FILE_LIST_CACHE_KEY}_${response.fileId}`
      CacheService.set(cacheKey, response, GeminiService.FILE_CACHE_DURATION)
    }

    return response
  }

  async retrieveFile(fileId: string): Promise<FileUploadResponse> {
    const cachedResponse = CacheService.get<any>(`${GeminiService.FILE_LIST_CACHE_KEY}_${fileId}`)
    if (cachedResponse) {
      return cachedResponse
    }

    const response = await this.fileManager.listFiles()

    if (response.files) {
      const file = response.files.filter((file) => file.state === FileState.ACTIVE).find((file) => file.name === fileId)
      if (file) {
        return {
          fileId: fileId,
          displayName: file.displayName || '',
          status: 'success',
          originalFile: file
        }
      }
    }

    return {
      fileId: fileId,
      displayName: '',
      status: 'failed',
      originalFile: undefined
    }
  }

  async listFiles(): Promise<FileListResponse> {
    const cachedList = CacheService.get<FileListResponse>(GeminiService.FILE_LIST_CACHE_KEY)
    if (cachedList) {
      return cachedList
    }
    const response = await this.fileManager.listFiles()
    const fileList: FileListResponse = {
      files: (response.files || [])
        .filter((file) => file.state === FileState.ACTIVE)
        .map((file) => {
          // 更新单个文件的缓存
          const fileResponse: FileUploadResponse = {
            fileId: file.name,
            displayName: file.displayName || '',
            status: 'success',
            originalFile: file
          }
          CacheService.set(
            `${GeminiService.FILE_LIST_CACHE_KEY}_${file.name}`,
            fileResponse,
            GeminiService.FILE_CACHE_DURATION
          )

          return {
            id: file.name,
            displayName: file.displayName || '',
            size: Number(file.sizeBytes),
            status: 'success',
            originalFile: file
          }
        })
    }

    // 更新文件列表缓存
    CacheService.set(GeminiService.FILE_LIST_CACHE_KEY, fileList, GeminiService.LIST_CACHE_DURATION)
    return fileList
  }

  async deleteFile(fileId: string): Promise<void> {
    await this.fileManager.deleteFile(fileId)
  }
}
