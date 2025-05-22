import { File, FileState, GoogleGenAI, Pager } from '@google/genai'
import { FileType } from '@types'
import fs from 'fs'

import { CacheService } from './CacheService'

export class GeminiService {
  private static readonly FILE_LIST_CACHE_KEY = 'gemini_file_list'
  private static readonly CACHE_DURATION = 3000

  static async uploadFile(
    _: Electron.IpcMainInvokeEvent,
    file: FileType,
    { apiKey, baseURL }: { apiKey: string; baseURL: string }
  ): Promise<File> {
    const sdk = new GoogleGenAI({
      vertexai: false,
      apiKey,
      httpOptions: {
        baseUrl: baseURL
      }
    })

    return await sdk.files.upload({
      file: file.path,
      config: {
        mimeType: 'application/pdf',
        name: file.id,
        displayName: file.origin_name
      }
    })
  }

  static async base64File(_: Electron.IpcMainInvokeEvent, file: FileType) {
    return {
      data: Buffer.from(fs.readFileSync(file.path)).toString('base64'),
      mimeType: 'application/pdf'
    }
  }

  static async retrieveFile(_: Electron.IpcMainInvokeEvent, file: FileType, apiKey: string): Promise<File | undefined> {
    const sdk = new GoogleGenAI({ vertexai: false, apiKey })
    const cachedResponse = CacheService.get<any>(GeminiService.FILE_LIST_CACHE_KEY)
    if (cachedResponse) {
      return GeminiService.processResponse(cachedResponse, file)
    }

    const response = await sdk.files.list()
    CacheService.set(GeminiService.FILE_LIST_CACHE_KEY, response, GeminiService.CACHE_DURATION)

    return GeminiService.processResponse(response, file)
  }

  private static async processResponse(response: Pager<File>, file: FileType) {
    for await (const f of response) {
      if (f.state === FileState.ACTIVE) {
        if (f.displayName === file.origin_name && Number(f.sizeBytes) === file.size) {
          return f
        }
      }
    }

    return undefined
  }

  static async listFiles(_: Electron.IpcMainInvokeEvent, apiKey: string): Promise<File[]> {
    const sdk = new GoogleGenAI({ vertexai: false, apiKey })
    const files: File[] = []
    for await (const f of await sdk.files.list()) {
      files.push(f)
    }
    return files
  }

  static async deleteFile(_: Electron.IpcMainInvokeEvent, fileId: string, apiKey: string) {
    const sdk = new GoogleGenAI({ vertexai: false, apiKey })
    await sdk.files.delete({ name: fileId })
  }
}
