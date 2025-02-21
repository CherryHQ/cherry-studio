import * as fs from 'node:fs'
import path from 'node:path'

import { RAGApplication, RAGApplicationBuilder, TextLoader } from '@llm-tools/embedjs'
import type { ExtractChunkData } from '@llm-tools/embedjs-interfaces'
import { LibSqlDb } from '@llm-tools/embedjs-libsql'
import { SitemapLoader } from '@llm-tools/embedjs-loader-sitemap'
import { WebLoader } from '@llm-tools/embedjs-loader-web'
import { AzureOpenAiEmbeddings, OpenAiEmbeddings } from '@llm-tools/embedjs-openai'
import { addFileLoader } from '@main/loader'
import { getInstanceName } from '@main/utils'
import { getAllFiles } from '@main/utils/file'
import type { LoaderReturn } from '@shared/config/types'
import { FileType, KnowledgeBaseParams, KnowledgeItem } from '@types'
import * as crypto from 'crypto'
import { app } from 'electron'
import { v4 as uuidv4 } from 'uuid'

import { knowledgeWatchService } from './KnowledgeWatchService'
import { windowService } from './WindowService'

class KnowledgeService {
  private storageDir = path.join(app.getPath('userData'), 'Data', 'KnowledgeBase')
  constructor() {
    this.initStorageDir()
  }

  private initStorageDir = (): void => {
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true })
    }
  }

  private getRagApplication = async ({
    id,
    model,
    apiKey,
    apiVersion,
    baseURL,
    dimensions
  }: KnowledgeBaseParams): Promise<RAGApplication> => {
    const batchSize = 10
    return new RAGApplicationBuilder()
      .setModel('NO_MODEL')
      .setEmbeddingModel(
        apiVersion
          ? new AzureOpenAiEmbeddings({
              azureOpenAIApiKey: apiKey,
              azureOpenAIApiVersion: apiVersion,
              azureOpenAIApiDeploymentName: model,
              azureOpenAIApiInstanceName: getInstanceName(baseURL),
              dimensions,
              batchSize
            })
          : new OpenAiEmbeddings({
              model,
              apiKey,
              configuration: { baseURL },
              dimensions,
              batchSize
            })
      )
      .setVectorDatabase(new LibSqlDb({ path: path.join(this.storageDir, id) }))
      .build()
  }

  public create = async (_: Electron.IpcMainInvokeEvent, base: KnowledgeBaseParams): Promise<void> => {
    this.getRagApplication(base)
  }

  public reset = async (_: Electron.IpcMainInvokeEvent, { base }: { base: KnowledgeBaseParams }): Promise<void> => {
    const ragApplication = await this.getRagApplication(base)
    await ragApplication.reset()
  }

  public delete = async (_: Electron.IpcMainInvokeEvent, id: string): Promise<void> => {
    const dbPath = path.join(this.storageDir, id)
    if (fs.existsSync(dbPath)) {
      fs.rmSync(dbPath, { recursive: true })
    }
  }

  public add = async (
    _: Electron.IpcMainInvokeEvent,
    { base, item, forceReload = false }: { base: KnowledgeBaseParams; item: KnowledgeItem; forceReload: boolean }
  ): Promise<LoaderReturn> => {
    const ragApplication = await this.getRagApplication(base)

    const sendDirectoryProcessingPercent = (totalFiles: number, processedFiles: number) => {
      const mainWindow = windowService.getMainWindow()
      mainWindow?.webContents.send(base.id, (processedFiles / totalFiles) * 100)
    }

    if (item.type === 'directory') {
      const directory = item.content as string
      const directoryId = `DirectoryLoader_${uuidv4()}`
      // 先添加目录本身
      const dirHash = crypto.createHash('sha256').update(directory).digest('hex')
      knowledgeWatchService.addFile('directory', directory, directoryId, dirHash)
      const files = getAllFiles(directory)
      const totalFiles = files.length
      let processedFiles = 0
      const promises = files.map(async (file) => {
        const fileContent = fs.readFileSync(file.path, 'utf-8')
        const fileHash = crypto.createHash('sha256').update(fileContent).digest('hex')
        const result = await addFileLoader(ragApplication, file, base, forceReload)
        const uniqueId = result.uniqueId || path.basename(file.path)

        knowledgeWatchService.addFile('file', file.path, uniqueId, fileHash, directoryId)

        processedFiles++

        sendDirectoryProcessingPercent(totalFiles, processedFiles)
        return result
      })
      const results = await Promise.all(promises)
      const uniqueIds = results.map((result) => result.uniqueId)
      return {
        entriesAdded: results.length,
        uniqueId: directoryId,
        uniqueIds,
        loaderType: 'DirectoryLoader'
      } as LoaderReturn
    }

    if (item.type === 'url') {
      const content = item.content as string
      if (content.startsWith('http')) {
        const loaderReturn = await ragApplication.addLoader(
          new WebLoader({ urlOrContent: content, chunkSize: base.chunkSize, chunkOverlap: base.chunkOverlap }) as any,
          forceReload
        )
        return {
          entriesAdded: loaderReturn.entriesAdded,
          uniqueId: loaderReturn.uniqueId,
          uniqueIds: [loaderReturn.uniqueId],
          loaderType: loaderReturn.loaderType
        } as LoaderReturn
      }
    }

    if (item.type === 'sitemap') {
      const content = item.content as string
      // @ts-ignore loader type
      const loaderReturn = await ragApplication.addLoader(
        new SitemapLoader({ url: content, chunkSize: base.chunkSize, chunkOverlap: base.chunkOverlap }) as any,
        forceReload
      )
      return {
        entriesAdded: loaderReturn.entriesAdded,
        uniqueId: loaderReturn.uniqueId,
        uniqueIds: [loaderReturn.uniqueId],
        loaderType: loaderReturn.loaderType
      } as LoaderReturn
    }

    if (item.type === 'note') {
      const content = item.content as string
      console.debug('chunkSize', base.chunkSize)
      const loaderReturn = await ragApplication.addLoader(
        new TextLoader({ text: content, chunkSize: base.chunkSize, chunkOverlap: base.chunkOverlap }),
        forceReload
      )
      return {
        entriesAdded: loaderReturn.entriesAdded,
        uniqueId: loaderReturn.uniqueId,
        uniqueIds: [loaderReturn.uniqueId],
        loaderType: loaderReturn.loaderType
      } as LoaderReturn
    }

    if (item.type === 'file') {
      const file = item.content as FileType
      const fileContent = fs.readFileSync(file.path, 'utf-8')
      const fileHash = crypto.createHash('sha256').update(fileContent).digest('hex')
      const result = await addFileLoader(ragApplication, file, base, forceReload)
      knowledgeWatchService.addFile(item.type, file.path, result.uniqueId, fileHash)
      return result
    }

    return { entriesAdded: 0, uniqueId: '', uniqueIds: [''], loaderType: '' }
  }

  public remove = async (
    _: Electron.IpcMainInvokeEvent,
    { uniqueId, uniqueIds, base }: { uniqueId: string; uniqueIds: string[]; base: KnowledgeBaseParams }
  ): Promise<void> => {
    const ragApplication = await this.getRagApplication(base)
    console.debug(`[ KnowledgeService Remove Item UniqueId: ${uniqueId}]`)
    for (const id of uniqueIds) {
      await ragApplication.deleteLoader(id)
    }
    // TODO knowledgeWatcher unwatch
  }

  public search = async (
    _: Electron.IpcMainInvokeEvent,
    { search, base }: { search: string; base: KnowledgeBaseParams }
  ): Promise<ExtractChunkData[]> => {
    const ragApplication = await this.getRagApplication(base)
    return await ragApplication.search(search)
  }
}

export default new KnowledgeService()
