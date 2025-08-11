import { File, Files, FileState, GoogleGenAI } from '@google/genai'
import { loggerService } from '@logger'
import { fileStorage } from '@main/services/FileStorage'
import { FileListResponse, FileMetadata, FileUploadResponse, Provider } from '@types'
import { v4 as uuidv4 } from 'uuid'

import { CacheService } from '../CacheService'
import { BaseFileService } from './BaseFileService'

const logger = loggerService.withContext('GeminiService')

export class GeminiService extends BaseFileService {
  private static readonly FILE_LIST_CACHE_KEY = 'gemini_file_list'
  private static readonly FILE_CACHE_DURATION = 48 * 60 * 60 * 1000
  private static readonly LIST_CACHE_DURATION = 3000

  protected readonly fileManager: Files

  constructor(provider: Provider) {
    super(provider)
    this.fileManager = new GoogleGenAI({
      vertexai: false,
      apiKey: provider.apiKey,
      httpOptions: {
        baseUrl: provider.apiHost
      }
    }).files
  }

  async uploadFile(file: FileMetadata): Promise<FileUploadResponse> {
    try {
      const uploadResult = await this.fileManager.upload({
        file: fileStorage.getFilePathById(file),
        config: {
          mimeType: 'application/pdf',
          name: file.id,
          displayName: file.origin_name
        }
      })

      // 根据文件状态设置响应状态
      let status: 'success' | 'processing' | 'failed' | 'unknown'
      switch (uploadResult.state) {
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
        fileId: uploadResult.name || '',
        displayName: file.origin_name,
        status,
        originalFile: {
          type: 'gemini',
          file: uploadResult
        }
      }

      // 只缓存成功的文件
      if (status === 'success') {
        const cacheKey = `${GeminiService.FILE_LIST_CACHE_KEY}_${response.fileId}`
        CacheService.set<FileUploadResponse>(cacheKey, response, GeminiService.FILE_CACHE_DURATION)
      }

      return response
    } catch (error) {
      logger.error('Error uploading file to Gemini:', error as Error)
      return {
        fileId: '',
        displayName: file.origin_name,
        status: 'failed',
        originalFile: undefined
      }
    }
  }

  async retrieveFile(fileId: string): Promise<FileUploadResponse> {
    try {
      const cachedResponse = CacheService.get<FileUploadResponse>(`${GeminiService.FILE_LIST_CACHE_KEY}_${fileId}`)
      logger.debug('[GeminiService] cachedResponse', cachedResponse)
      if (cachedResponse) {
        return cachedResponse
      }
      const files: File[] = []

      for await (const f of await this.fileManager.list()) {
        files.push(f)
      }
      logger.debug('files', files)
      const file = files
        .filter((file) => file.state === FileState.ACTIVE)
        .find((file) => file.name?.substring(6) === fileId) // 去掉 files/ 前缀
      logger.debug('file', file)
      if (file) {
        return {
          fileId: fileId,
          displayName: file.displayName || '',
          status: 'success',
          originalFile: {
            type: 'gemini',
            file
          }
        }
      }

      return {
        fileId: fileId,
        displayName: '',
        status: 'failed',
        originalFile: undefined
      }
    } catch (error) {
      logger.error('Error retrieving file from Gemini:', error as Error)
      return {
        fileId: fileId,
        displayName: '',
        status: 'failed',
        originalFile: undefined
      }
    }
  }

  async listFiles(): Promise<FileListResponse> {
    try {
      const cachedList = CacheService.get<FileListResponse>(GeminiService.FILE_LIST_CACHE_KEY)
      if (cachedList) {
        return cachedList
      }
      const geminiFiles: File[] = []

      for await (const f of await this.fileManager.list()) {
        geminiFiles.push(f)
      }
      const fileList: FileListResponse = {
        files: geminiFiles
          .filter((file) => file.state === FileState.ACTIVE)
          .map((file) => {
            // 更新单个文件的缓存
            const fileResponse: FileUploadResponse = {
              fileId: file.name || uuidv4(),
              displayName: file.displayName || '',
              status: 'success',
              originalFile: {
                type: 'gemini',
                file
              }
            }
            CacheService.set(
              `${GeminiService.FILE_LIST_CACHE_KEY}_${file.name}`,
              fileResponse,
              GeminiService.FILE_CACHE_DURATION
            )

            return {
              id: file.name || uuidv4(),
              displayName: file.displayName || '',
              size: Number(file.sizeBytes),
              status: 'success',
              originalFile: {
                type: 'gemini',
                file
              }
            }
          })
      }

      // 更新文件列表缓存
      CacheService.set(GeminiService.FILE_LIST_CACHE_KEY, fileList, GeminiService.LIST_CACHE_DURATION)
      return fileList
    } catch (error) {
      logger.error('Error listing files from Gemini:', error as Error)
      return { files: [] }
    }
  }

  async deleteFile(fileId: string): Promise<void> {
    try {
      await this.fileManager.delete({ name: fileId })
      logger.debug(`File ${fileId} deleted from Gemini`)
    } catch (error) {
      logger.error('Error deleting file from Gemini:', error as Error)
      throw error
    }
  }
}
