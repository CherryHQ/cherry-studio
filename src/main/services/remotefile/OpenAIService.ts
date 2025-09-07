import { loggerService } from '@logger'
import { fileStorage } from '@main/services/FileStorage'
import { FileListResponse, FileMetadata, FileUploadResponse, Provider } from '@types'
import * as fs from 'fs'
import OpenAI from 'openai'

import { CacheService } from '../CacheService'
import { BaseFileService } from './BaseFileService'

const logger = loggerService.withContext('OpenAIService')

export class OpenaiService extends BaseFileService {
  private static readonly FILE_CACHE_DURATION = 7 * 24 * 60 * 60 * 1000
  private static readonly generateUIFileIdCacheKey = (fileId: string) => `ui_file_id_${fileId}`
  private readonly client: OpenAI

  constructor(provider: Provider) {
    super(provider)
    this.client = new OpenAI({
      apiKey: provider.apiKey,
      baseURL: provider.apiHost
    })
  }

  async uploadFile(file: FileMetadata): Promise<FileUploadResponse> {
    let fileReadStream: fs.ReadStream | undefined
    try {
      fileReadStream = fs.createReadStream(fileStorage.getFilePathById(file))
      // 还原文件原始名，以提高模型对文件的理解
      const fileStreamWithMeta = Object.assign(fileReadStream, {
        name: file.origin_name
      })
      const response = await this.client.files.create({
        file: fileStreamWithMeta,
        purpose: file.purpose || 'assistants'
      })
      if (!response.id) {
        throw new Error('File id not found in response')
      }
      // 映射RemoteFileId到UIFileId上
      CacheService.set<string>(
        OpenaiService.generateUIFileIdCacheKey(file.id),
        response.id,
        OpenaiService.FILE_CACHE_DURATION
      )
      return {
        fileId: response.id,
        displayName: file.origin_name,
        status: 'success',
        originalFile: {
          type: 'openai',
          file: response
        }
      }
    } catch (error) {
      logger.error('Error uploading file:', error as Error)
      return {
        fileId: '',
        displayName: file.origin_name,
        status: 'failed'
      }
    } finally {
      // 销毁文件流
      if (fileReadStream) fileReadStream.destroy()
    }
  }

  async listFiles(): Promise<FileListResponse> {
    try {
      const response = await this.client.files.list()
      return {
        files: response.data.map((file) => ({
          id: file.id,
          displayName: file.filename || '',
          size: file.bytes,
          status: 'success', // All listed files are processed,
          originalFile: {
            type: 'openai',
            file
          }
        }))
      }
    } catch (error) {
      logger.error('Error listing files:', error as Error)
      return { files: [] }
    }
  }

  async deleteFile(fileId: string): Promise<void> {
    try {
      const cachedRemoteFileId = CacheService.get<string>(OpenaiService.generateUIFileIdCacheKey(fileId))
      await this.client.files.delete(cachedRemoteFileId || fileId)
      logger.debug(`File ${fileId} deleted`)
    } catch (error) {
      logger.error('Error deleting file:', error as Error)
      throw error
    }
  }

  async retrieveFile(fileId: string): Promise<FileUploadResponse> {
    try {
      // 尝试反映射RemoteFileId
      const cachedRemoteFileId = CacheService.get<string>(OpenaiService.generateUIFileIdCacheKey(fileId))
      const response = await this.client.files.retrieve(cachedRemoteFileId || fileId)

      return {
        fileId: response.id,
        displayName: response.filename,
        status: 'success',
        originalFile: {
          type: 'openai',
          file: response
        }
      }
    } catch (error) {
      logger.error('Error retrieving file:', error as Error)
      return {
        fileId: fileId,
        displayName: '',
        status: 'failed',
        originalFile: undefined
      }
    }
  }
}
