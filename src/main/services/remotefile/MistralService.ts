import fs from 'node:fs/promises'

import { loggerService } from '@logger'
import { fileStorage } from '@main/services/FileStorage'
import { Mistral } from '@mistralai/mistralai'
import { FileListResponse, FileMetadata, FileUploadResponse, Provider } from '@types'

import { MistralClientManager } from '../MistralClientManager'
import { BaseFileService } from './BaseFileService'

const logger = loggerService.withContext('MistralService')

export class MistralService extends BaseFileService {
  private readonly client: Mistral

  constructor(provider: Provider) {
    super(provider)
    const clientManager = MistralClientManager.getInstance()
    clientManager.initializeClient(provider)
    this.client = clientManager.getClient()
  }

  async uploadFile(file: FileMetadata): Promise<FileUploadResponse> {
    try {
      const fileBuffer = await fs.readFile(fileStorage.getFilePathById(file))
      const response = await this.client.files.upload({
        file: {
          fileName: file.origin_name,
          content: new Uint8Array(fileBuffer)
        },
        purpose: 'ocr'
      })

      return {
        fileId: response.id,
        displayName: file.origin_name,
        status: 'success',
        originalFile: {
          type: 'mistral',
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
    }
  }

  async listFiles(): Promise<FileListResponse> {
    try {
      const response = await this.client.files.list({})
      return {
        files: response.data.map((file) => ({
          id: file.id,
          displayName: file.filename || '',
          size: file.sizeBytes,
          status: 'success', // All listed files are processed,
          originalFile: {
            type: 'mistral',
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
      await this.client.files.delete({
        fileId
      })
      logger.debug(`File ${fileId} deleted`)
    } catch (error) {
      logger.error('Error deleting file:', error as Error)
      throw error
    }
  }

  async retrieveFile(fileId: string): Promise<FileUploadResponse> {
    try {
      const response = await this.client.files.retrieve({
        fileId
      })

      return {
        fileId: response.id,
        displayName: response.filename || '',
        status: 'success' // Retrieved files are always processed
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
