import * as fs from 'node:fs'
import path from 'node:path'

import { RAGApplication, RAGApplicationBuilder } from '@cherrystudio/embedjs'
import { LibSqlDb } from '@cherrystudio/embedjs-libsql'
import { SitemapLoader } from '@cherrystudio/embedjs-loader-sitemap'
import { WebLoader } from '@cherrystudio/embedjs-loader-web'
import { loggerService } from '@logger'
import Embeddings from '@main/knowledge/embedjs/embeddings/Embeddings'
import { addFileLoader } from '@main/knowledge/embedjs/loader'
import { NoteLoader } from '@main/knowledge/embedjs/loader/noteLoader'
import { preprocessingService } from '@main/knowledge/preprocess/PreprocessingService'
import { getAllFiles } from '@main/utils/file'
import { MB } from '@shared/config/constant'
import { LoaderReturn } from '@shared/config/types'
import { IpcChannel } from '@shared/IpcChannel'
import { FileMetadata, KnowledgeBaseParams, KnowledgeSearchResult } from '@types'
import { v4 as uuidv4 } from 'uuid'

import { windowService } from '../WindowService'
import {
  IKnowledgeFramework,
  KnowledgeBaseAddItemOptionsNonNullableAttribute,
  LoaderDoneReturn,
  LoaderTask,
  LoaderTaskItem,
  LoaderTaskItemState
} from './IKnowledgeFramework'

const logger = loggerService.withContext('MainKnowledgeService')

export class EmbedJsFramework implements IKnowledgeFramework {
  private storageDir: string
  private ragApplications: Map<string, RAGApplication> = new Map()
  private pendingDeleteFile: string
  private dbInstances: Map<string, LibSqlDb> = new Map()

  private static ERROR_LOADER_RETURN: LoaderReturn = {
    entriesAdded: 0,
    uniqueId: '',
    uniqueIds: [''],
    loaderType: '',
    status: 'failed'
  }

  constructor(storageDir: string) {
    this.storageDir = storageDir
    this.pendingDeleteFile = path.join(this.storageDir, 'knowledge_pending_delete.json')
    this.initStorageDir()
    this.cleanupOnStartup()
  }

  private initStorageDir = (): void => {
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true })
    }
  }

  /**
   * Clean up knowledge base resources (RAG applications and database connections in memory)
   */
  private cleanupKnowledgeResources = async (id: string): Promise<void> => {
    try {
      // Remove RAG application instance
      if (this.ragApplications.has(id)) {
        const ragApp = this.ragApplications.get(id)!
        await ragApp.reset()
        this.ragApplications.delete(id)
        logger.debug(`Cleaned up RAG application for id: ${id}`)
      }

      // Remove database instance reference
      if (this.dbInstances.has(id)) {
        this.dbInstances.delete(id)
        logger.debug(`Removed database instance reference for id: ${id}`)
      }
    } catch (error) {
      logger.warn(`Failed to cleanup resources for id: ${id}`, error as Error)
    }
  }

  /**
   * Delete knowledge base file
   */
  private deleteKnowledgeFile = (id: string): boolean => {
    const dbPath = path.join(this.storageDir, id)
    if (fs.existsSync(dbPath)) {
      try {
        fs.rmSync(dbPath, { recursive: true })
        logger.debug(`Deleted knowledge base file with id: ${id}`)
        return true
      } catch (error) {
        logger.warn(`Failed to delete knowledge base file with id: ${id}: ${error}`)
        return false
      }
    }
    return true // File does not exist, consider deletion successful
  }

  /**
   * Manage persistent deletion list
   */
  private pendingDeleteManager = {
    load: (): string[] => {
      try {
        if (fs.existsSync(this.pendingDeleteFile)) {
          return JSON.parse(fs.readFileSync(this.pendingDeleteFile, 'utf-8')) as string[]
        }
      } catch (error) {
        logger.warn('Failed to load pending delete IDs:', error as Error)
      }
      return []
    },

    save: (ids: string[]): void => {
      try {
        fs.writeFileSync(this.pendingDeleteFile, JSON.stringify(ids, null, 2))
        logger.debug(`Total ${ids.length} knowledge bases pending delete`)
      } catch (error) {
        logger.warn('Failed to save pending delete IDs:', error as Error)
      }
    },

    add: (id: string): void => {
      const existingIds = this.pendingDeleteManager.load()
      const allIds = [...new Set([...existingIds, id])]
      this.pendingDeleteManager.save(allIds)
    },

    clear: (): void => {
      try {
        if (fs.existsSync(this.pendingDeleteFile)) {
          fs.unlinkSync(this.pendingDeleteFile)
        }
      } catch (error) {
        logger.warn('Failed to clear pending delete file:', error as Error)
      }
    }
  }

  /**
   * Clean up databases marked for deletion on startup
   */
  private cleanupOnStartup = (): void => {
    const pendingDeleteIds = this.pendingDeleteManager.load()
    if (pendingDeleteIds.length === 0) return

    logger.info(`Found ${pendingDeleteIds.length} knowledge bases pending deletion from previous session`)

    let deletedCount = 0
    pendingDeleteIds.forEach((id) => {
      if (this.deleteKnowledgeFile(id)) {
        deletedCount++
      } else {
        logger.warn(`Failed to delete knowledge base ${id}, please delete it manually`)
      }
    })

    this.pendingDeleteManager.clear()
    logger.info(`Startup cleanup completed: ${deletedCount}/${pendingDeleteIds.length} knowledge bases deleted`)
  }

  private async getRagApplication(base: KnowledgeBaseParams): Promise<RAGApplication> {
    if (this.ragApplications.has(base.id)) {
      return this.ragApplications.get(base.id)!
    }

    let ragApplication: RAGApplication
    const embeddings = new Embeddings({
      embedApiClient: base.embedApiClient,
      dimensions: base.dimensions
    })
    try {
      const libSqlDb = new LibSqlDb({ path: path.join(this.storageDir, base.id) })
      // Save database instance for later closing
      this.dbInstances.set(base.id, libSqlDb)

      ragApplication = await new RAGApplicationBuilder()
        .setModel('NO_MODEL')
        .setEmbeddingModel(embeddings)
        .setVectorDatabase(libSqlDb)
        .setSearchResultCount(base.documentCount || 30)
        .build()
      this.ragApplications.set(base.id, ragApplication)
    } catch (e) {
      logger.error('Failed to create RAGApplication:', e as Error)
      throw new Error(`Failed to create RAGApplication: ${e}`)
    }

    return ragApplication
  }
  async initialize(base: KnowledgeBaseParams): Promise<void> {
    await this.getRagApplication(base)
  }
  async reset(base: KnowledgeBaseParams): Promise<void> {
    const ragApp = await this.getRagApplication(base)
    await ragApp.reset()
  }
  async delete(id: string): Promise<void> {
    logger.debug(`delete id: ${id}`)

    await this.cleanupKnowledgeResources(id)

    await new Promise((resolve) => setTimeout(resolve, 100))

    // Try to delete database file immediately
    if (!this.deleteKnowledgeFile(id)) {
      logger.debug(`Will delete knowledge base ${id} on next startup`)
      this.pendingDeleteManager.add(id)
    }
  }
  getLoaderTask(options: KnowledgeBaseAddItemOptionsNonNullableAttribute): LoaderTask {
    const { item } = options
    const getRagApplication = () => this.getRagApplication(options.base)
    switch (item.type) {
      case 'file':
        return this.fileTask(getRagApplication, options)
      case 'directory':
        return this.directoryTask(getRagApplication, options)
      case 'url':
        return this.urlTask(getRagApplication, options)
      case 'sitemap':
        return this.sitemapTask(getRagApplication, options)
      case 'note':
        return this.noteTask(getRagApplication, options)
      default:
        return {
          loaderTasks: [],
          loaderDoneReturn: null
        }
    }
  }

  async remove(options: { uniqueIds: string[]; base: KnowledgeBaseParams }): Promise<void> {
    const ragApp = await this.getRagApplication(options.base)
    for (const id of options.uniqueIds) {
      await ragApp.deleteLoader(id)
    }
  }
  async search(options: { search: string; base: KnowledgeBaseParams }): Promise<KnowledgeSearchResult[]> {
    const ragApp = await this.getRagApplication(options.base)
    return await ragApp.search(options.search)
  }

  private fileTask(
    getRagApplication: () => Promise<RAGApplication>,
    options: KnowledgeBaseAddItemOptionsNonNullableAttribute
  ): LoaderTask {
    const { base, item, forceReload, userId } = options
    const file = item.content as FileMetadata

    const loaderTask: LoaderTask = {
      loaderTasks: [
        {
          state: LoaderTaskItemState.PENDING,
          task: async () => {
            try {
              // Add preprocessing logic
              const ragApplication = await getRagApplication()
              const fileToProcess: FileMetadata = await preprocessingService.preprocessFile(file, base, item, userId)

              // Use processed file for loading
              return addFileLoader(ragApplication, fileToProcess, base, forceReload)
                .then((result) => {
                  loaderTask.loaderDoneReturn = result
                  return result
                })
                .catch((e) => {
                  logger.error(`Error in addFileLoader for ${file.name}: ${e}`)
                  const errorResult: LoaderReturn = {
                    ...EmbedJsFramework.ERROR_LOADER_RETURN,
                    message: e.message,
                    messageSource: 'embedding'
                  }
                  loaderTask.loaderDoneReturn = errorResult
                  return errorResult
                })
            } catch (e: any) {
              logger.error(`Preprocessing failed for ${file.name}: ${e}`)
              const errorResult: LoaderReturn = {
                ...EmbedJsFramework.ERROR_LOADER_RETURN,
                message: e.message,
                messageSource: 'preprocess'
              }
              loaderTask.loaderDoneReturn = errorResult
              return errorResult
            }
          },
          evaluateTaskWorkload: { workload: file.size }
        }
      ],
      loaderDoneReturn: null
    }

    return loaderTask
  }
  private directoryTask(
    getRagApplication: () => Promise<RAGApplication>,
    options: KnowledgeBaseAddItemOptionsNonNullableAttribute
  ): LoaderTask {
    const { base, item, forceReload } = options
    const directory = item.content as string
    const files = getAllFiles(directory)
    const totalFiles = files.length
    let processedFiles = 0

    const sendDirectoryProcessingPercent = (totalFiles: number, processedFiles: number) => {
      const mainWindow = windowService.getMainWindow()
      mainWindow?.webContents.send(IpcChannel.DirectoryProcessingPercent, {
        itemId: item.id,
        percent: (processedFiles / totalFiles) * 100
      })
    }

    const loaderDoneReturn: LoaderDoneReturn = {
      entriesAdded: 0,
      uniqueId: `DirectoryLoader_${uuidv4()}`,
      uniqueIds: [],
      loaderType: 'DirectoryLoader'
    }
    const loaderTasks: LoaderTaskItem[] = []
    for (const file of files) {
      loaderTasks.push({
        state: LoaderTaskItemState.PENDING,
        task: async () => {
          const ragApplication = await getRagApplication()
          return addFileLoader(ragApplication, file, base, forceReload)
            .then((result) => {
              loaderDoneReturn.entriesAdded += 1
              processedFiles += 1
              sendDirectoryProcessingPercent(totalFiles, processedFiles)
              loaderDoneReturn.uniqueIds.push(result.uniqueId)
              return result
            })
            .catch((err) => {
              logger.error('Failed to add dir loader:', err)
              return {
                ...EmbedJsFramework.ERROR_LOADER_RETURN,
                message: `Failed to add dir loader: ${err.message}`,
                messageSource: 'embedding'
              }
            })
        },
        evaluateTaskWorkload: { workload: file.size }
      })
    }

    return {
      loaderTasks,
      loaderDoneReturn
    }
  }

  private urlTask(
    getRagApplication: () => Promise<RAGApplication>,
    options: KnowledgeBaseAddItemOptionsNonNullableAttribute
  ): LoaderTask {
    const { base, item, forceReload } = options
    const content = item.content as string

    const loaderTask: LoaderTask = {
      loaderTasks: [
        {
          state: LoaderTaskItemState.PENDING,
          task: async () => {
            const ragApplication = await getRagApplication()
            const loaderReturn = ragApplication.addLoader(
              new WebLoader({
                urlOrContent: content,
                chunkSize: base.chunkSize,
                chunkOverlap: base.chunkOverlap
              }),
              forceReload
            ) as Promise<LoaderReturn>

            return loaderReturn
              .then((result) => {
                const { entriesAdded, uniqueId, loaderType } = result
                loaderTask.loaderDoneReturn = {
                  entriesAdded: entriesAdded,
                  uniqueId: uniqueId,
                  uniqueIds: [uniqueId],
                  loaderType: loaderType
                }
                return result
              })
              .catch((err) => {
                logger.error('Failed to add url loader:', err)
                return {
                  ...EmbedJsFramework.ERROR_LOADER_RETURN,
                  message: `Failed to add url loader: ${err.message}`,
                  messageSource: 'embedding'
                }
              })
          },
          evaluateTaskWorkload: { workload: 2 * MB }
        }
      ],
      loaderDoneReturn: null
    }
    return loaderTask
  }

  private sitemapTask(
    getRagApplication: () => Promise<RAGApplication>,
    options: KnowledgeBaseAddItemOptionsNonNullableAttribute
  ): LoaderTask {
    const { base, item, forceReload } = options
    const content = item.content as string

    const loaderTask: LoaderTask = {
      loaderTasks: [
        {
          state: LoaderTaskItemState.PENDING,
          task: async () => {
            const ragApplication = await getRagApplication()
            return ragApplication
              .addLoader(
                new SitemapLoader({ url: content, chunkSize: base.chunkSize, chunkOverlap: base.chunkOverlap }) as any,
                forceReload
              )
              .then((result) => {
                const { entriesAdded, uniqueId, loaderType } = result
                loaderTask.loaderDoneReturn = {
                  entriesAdded: entriesAdded,
                  uniqueId: uniqueId,
                  uniqueIds: [uniqueId],
                  loaderType: loaderType
                }
                return result
              })
              .catch((err) => {
                logger.error('Failed to add sitemap loader:', err)
                return {
                  ...EmbedJsFramework.ERROR_LOADER_RETURN,
                  message: `Failed to add sitemap loader: ${err.message}`,
                  messageSource: 'embedding'
                }
              })
          },
          evaluateTaskWorkload: { workload: 20 * MB }
        }
      ],
      loaderDoneReturn: null
    }
    return loaderTask
  }

  private noteTask(
    getRagApplication: () => Promise<RAGApplication>,
    options: KnowledgeBaseAddItemOptionsNonNullableAttribute
  ): LoaderTask {
    const { base, item, forceReload } = options
    const content = item.content as string
    const sourceUrl = (item as any).sourceUrl

    const encoder = new TextEncoder()
    const contentBytes = encoder.encode(content)
    const loaderTask: LoaderTask = {
      loaderTasks: [
        {
          state: LoaderTaskItemState.PENDING,
          task: async () => {
            const ragApplication = await getRagApplication()
            const loaderReturn = ragApplication.addLoader(
              new NoteLoader({
                text: content,
                sourceUrl,
                chunkSize: base.chunkSize,
                chunkOverlap: base.chunkOverlap
              }),
              forceReload
            ) as Promise<LoaderReturn>

            return loaderReturn
              .then(({ entriesAdded, uniqueId, loaderType }) => {
                loaderTask.loaderDoneReturn = {
                  entriesAdded: entriesAdded,
                  uniqueId: uniqueId,
                  uniqueIds: [uniqueId],
                  loaderType: loaderType
                }
              })
              .catch((err) => {
                logger.error('Failed to add note loader:', err)
                return {
                  ...EmbedJsFramework.ERROR_LOADER_RETURN,
                  message: `Failed to add note loader: ${err.message}`,
                  messageSource: 'embedding'
                }
              })
          },
          evaluateTaskWorkload: { workload: contentBytes.length }
        }
      ],
      loaderDoneReturn: null
    }
    return loaderTask
  }
}
