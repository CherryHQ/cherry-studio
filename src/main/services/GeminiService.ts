import { FileMetadataResponse, FileState, GoogleAIFileManager } from '@google/generative-ai/server'
import { FileType } from '@types'
import fs from 'fs'

import { CacheService } from './CacheService'
import { proxyManager } from './ProxyManager'

export class GeminiService {
  private static readonly FILE_LIST_CACHE_KEY = 'gemini_file_list'
  private static readonly CACHE_DURATION = 3000

  static async uploadFile(_: Electron.IpcMainInvokeEvent, file: FileType, apiKey: string) {
    proxyManager.setGlobalProxy()
    const fileManager = new GoogleAIFileManager(apiKey)
    const uploadResult = await fileManager.uploadFile(file.path, {
      mimeType: 'application/pdf',
      displayName: file.origin_name
    })
    return uploadResult
  }

  static async base64File(_: Electron.IpcMainInvokeEvent, file: FileType) {
    return {
      data: Buffer.from(fs.readFileSync(file.path)).toString('base64'),
      mimeType: 'application/pdf'
    }
  }

  static async retrieveFile(
    _: Electron.IpcMainInvokeEvent,
    file: FileType,
    apiKey: string
  ): Promise<FileMetadataResponse | undefined> {
    proxyManager.setGlobalProxy()
    const fileManager = new GoogleAIFileManager(apiKey)

    const cachedResponse = CacheService.get<any>(GeminiService.FILE_LIST_CACHE_KEY)
    if (cachedResponse) {
      return GeminiService.processResponse(cachedResponse, file)
    }

    const response = await fileManager.listFiles()
    CacheService.set(GeminiService.FILE_LIST_CACHE_KEY, response, GeminiService.CACHE_DURATION)

    return GeminiService.processResponse(response, file)
  }

  private static processResponse(response: any, file: FileType) {
    if (response.files) {
      return response.files
        .filter((file) => file.state === FileState.ACTIVE)
        .find((i) => i.displayName === file.origin_name && Number(i.sizeBytes) === file.size)
    }
    return undefined
  }

  static async listFiles(_: Electron.IpcMainInvokeEvent, apiKey: string) {
    proxyManager.setGlobalProxy()
    const fileManager = new GoogleAIFileManager(apiKey)
    return await fileManager.listFiles()
  }

  static async deleteFile(_: Electron.IpcMainInvokeEvent, apiKey: string, fileId: string) {
    proxyManager.setGlobalProxy()
    const fileManager = new GoogleAIFileManager(apiKey)
    await fileManager.deleteFile(fileId)
  }
}
