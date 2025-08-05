/**
 * Knowledge Service - Manages knowledge bases using RAG (Retrieval-Augmented Generation)
 *
 * This service handles creation, management, and querying of knowledge bases from various sources
 * including files, directories, URLs, sitemaps, and notes.
 *
 * Features:
 * - Concurrent task processing with workload management
 * - Multiple data source support
 * - Vector database integration
 *
 * For detailed documentation, see:
 * @see {@link ../../../docs/technical/KnowledgeService.md}
 */

import * as fs from 'node:fs'
import path from 'node:path'

import { RAGApplication, RAGApplicationBuilder } from '@cherrystudio/embedjs'
import type { ExtractChunkData } from '@cherrystudio/embedjs-interfaces'
import { LibSqlDb } from '@cherrystudio/embedjs-libsql'
import { SitemapLoader } from '@cherrystudio/embedjs-loader-sitemap'
import { WebLoader } from '@cherrystudio/embedjs-loader-web'
import { loggerService } from '@logger'
import Embeddings from '@main/knowledge/embeddings/Embeddings'
import { addFileLoader } from '@main/knowledge/loader'
import { NoteLoader } from '@main/knowledge/loader/noteLoader'
import PreprocessProvider from '@main/knowledge/preprocess/PreprocessProvider'
import Reranker from '@main/knowledge/reranker/Reranker'
import { windowService } from '@main/services/WindowService'
import { getDataPath } from '@main/utils'
import { getAllFiles } from '@main/utils/file'
import { TraceMethod } from '@mcp-trace/trace-core'
import { MB } from '@shared/config/constant'
import type { LoaderReturn } from '@shared/config/types'
import { IpcChannel } from '@shared/IpcChannel'
import { FileMetadata, KnowledgeBaseParams, KnowledgeItem } from '@types'
import { v4 as uuidv4 } from 'uuid'

const logger = loggerService.withContext('MainKnowledgeService')

export interface KnowledgeBaseAddItemOptions {
  base: KnowledgeBaseParams
  item: KnowledgeItem
  forceReload?: boolean
  userId?: string
}

interface KnowledgeBaseAddItemOptionsNonNullableAttribute {
  base: KnowledgeBaseParams
  item: KnowledgeItem
  forceReload: boolean
  userId: string
}

interface EvaluateTaskWorkload {
  workload: number
}

type LoaderDoneReturn = LoaderReturn | null

enum LoaderTaskItemState {
  PENDING,
  PROCESSING,
  DONE
}

interface LoaderTaskItem {
  state: LoaderTaskItemState
  task: () => Promise<unknown>
  evaluateTaskWorkload: EvaluateTaskWorkload
}

interface LoaderTask {
  loaderTasks: LoaderTaskItem[]
  loaderDoneReturn: LoaderDoneReturn
}

interface LoaderTaskOfSet {
  loaderTasks: Set<LoaderTaskItem>
  loaderDoneReturn: LoaderDoneReturn
}

interface QueueTaskItem {
  taskPromise: () => Promise<unknown>
  resolve: () => void
  evaluateTaskWorkload: EvaluateTaskWorkload
}

const loaderTaskIntoOfSet = (loaderTask: LoaderTask): LoaderTaskOfSet => {
  return {
    loaderTasks: new Set(loaderTask.loaderTasks),
    loaderDoneReturn: loaderTask.loaderDoneReturn
  }
}

class KnowledgeService {
  private storageDir = path.join(getDataPath(), 'KnowledgeBase')
  private pendingDeleteFile = path.join(this.storageDir, 'knowledge_pending_delete.json')
  // Byte based
  private workload = 0
  private processingItemCount = 0
  private knowledgeItemProcessingQueueMappingPromise: Map<LoaderTaskOfSet, () => void> = new Map()
  private ragApplications: Map<string, RAGApplication> = new Map()
  private dbInstances: Map<string, LibSqlDb> = new Map()
  private static MAXIMUM_WORKLOAD = 80 * MB
  private static MAXIMUM_PROCESSING_ITEM_COUNT = 30
  private static ERROR_LOADER_RETURN: LoaderReturn = {
    entriesAdded: 0,
    uniqueId: '',
    uniqueIds: [''],
    loaderType: '',
    status: 'failed'
  }

  constructor() {
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

  private getRagApplication = async ({
    id,
    embedApiClient,
    dimensions,
    documentCount
  }: KnowledgeBaseParams): Promise<RAGApplication> => {
    if (this.ragApplications.has(id)) {
      return this.ragApplications.get(id)!
    }

    let ragApplication: RAGApplication
    const embeddings = new Embeddings({
      embedApiClient,
      dimensions
    })
    try {
      const libSqlDb = new LibSqlDb({ path: path.join(this.storageDir, id) })
      // Save database instance for later closing
      this.dbInstances.set(id, libSqlDb)

      ragApplication = await new RAGApplicationBuilder()
        .setModel('NO_MODEL')
        .setEmbeddingModel(embeddings)
        .setVectorDatabase(libSqlDb)
        .setSearchResultCount(documentCount || 30)
        .build()
      this.ragApplications.set(id, ragApplication)
    } catch (e) {
      logger.error('Failed to create RAGApplication:', e as Error)
      throw new Error(`Failed to create RAGApplication: ${e}`)
    }

    return ragApplication
  }

  public create = async (_: Electron.IpcMainInvokeEvent, base: KnowledgeBaseParams): Promise<void> => {
    await this.getRagApplication(base)
  }

  public reset = async (_: Electron.IpcMainInvokeEvent, base: KnowledgeBaseParams): Promise<void> => {
    const ragApplication = await this.getRagApplication(base)
    await ragApplication.reset()
  }

  public async delete(_: Electron.IpcMainInvokeEvent, id: string): Promise<void> {
    logger.debug(`delete id: ${id}`)

    await this.cleanupKnowledgeResources(id)

    await new Promise((resolve) => setTimeout(resolve, 100))

    // Try to delete database file immediately
    if (!this.deleteKnowledgeFile(id)) {
      logger.debug(`Will delete knowledge base ${id} on next startup`)
      this.pendingDeleteManager.add(id)
    }
  }

  private maximumLoad() {
    return (
      this.processingItemCount >= KnowledgeService.MAXIMUM_PROCESSING_ITEM_COUNT ||
      this.workload >= KnowledgeService.MAXIMUM_WORKLOAD
    )
  }
  private fileTask(
    ragApplication: RAGApplication,
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
              const fileToProcess: FileMetadata = await this.preprocessing(file, base, item, userId)

              // Use processed file for loading
              return addFileLoader(ragApplication, fileToProcess, base, forceReload)
                .then((result) => {
                  loaderTask.loaderDoneReturn = result
                  return result
                })
                .catch((e) => {
                  logger.error(`Error in addFileLoader for ${file.name}: ${e}`)
                  const errorResult: LoaderReturn = {
                    ...KnowledgeService.ERROR_LOADER_RETURN,
                    message: e.message,
                    messageSource: 'embedding'
                  }
                  loaderTask.loaderDoneReturn = errorResult
                  return errorResult
                })
            } catch (e: any) {
              logger.error(`Preprocessing failed for ${file.name}: ${e}`)
              const errorResult: LoaderReturn = {
                ...KnowledgeService.ERROR_LOADER_RETURN,
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
    ragApplication: RAGApplication,
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
        task: () =>
          addFileLoader(ragApplication, file, base, forceReload)
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
                ...KnowledgeService.ERROR_LOADER_RETURN,
                message: `Failed to add dir loader: ${err.message}`,
                messageSource: 'embedding'
              }
            }),
        evaluateTaskWorkload: { workload: file.size }
      })
    }

    return {
      loaderTasks,
      loaderDoneReturn
    }
  }

  private urlTask(
    ragApplication: RAGApplication,
    options: KnowledgeBaseAddItemOptionsNonNullableAttribute
  ): LoaderTask {
    const { base, item, forceReload } = options
    const content = item.content as string

    const loaderTask: LoaderTask = {
      loaderTasks: [
        {
          state: LoaderTaskItemState.PENDING,
          task: () => {
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
                  ...KnowledgeService.ERROR_LOADER_RETURN,
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
    ragApplication: RAGApplication,
    options: KnowledgeBaseAddItemOptionsNonNullableAttribute
  ): LoaderTask {
    const { base, item, forceReload } = options
    const content = item.content as string

    const loaderTask: LoaderTask = {
      loaderTasks: [
        {
          state: LoaderTaskItemState.PENDING,
          task: () =>
            ragApplication
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
                  ...KnowledgeService.ERROR_LOADER_RETURN,
                  message: `Failed to add sitemap loader: ${err.message}`,
                  messageSource: 'embedding'
                }
              }),
          evaluateTaskWorkload: { workload: 20 * MB }
        }
      ],
      loaderDoneReturn: null
    }
    return loaderTask
  }

  private noteTask(
    ragApplication: RAGApplication,
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
          task: () => {
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
                  ...KnowledgeService.ERROR_LOADER_RETURN,
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

  private processingQueueHandle() {
    const getSubtasksUntilMaximumLoad = (): QueueTaskItem[] => {
      const queueTaskList: QueueTaskItem[] = []
      that: for (const [task, resolve] of this.knowledgeItemProcessingQueueMappingPromise) {
        for (const item of task.loaderTasks) {
          if (this.maximumLoad()) {
            break that
          }

          const { state, task: taskPromise, evaluateTaskWorkload } = item

          if (state !== LoaderTaskItemState.PENDING) {
            continue
          }

          const { workload } = evaluateTaskWorkload
          this.workload += workload
          this.processingItemCount += 1
          item.state = LoaderTaskItemState.PROCESSING
          queueTaskList.push({
            taskPromise: () =>
              taskPromise().then(() => {
                this.workload -= workload
                this.processingItemCount -= 1
                task.loaderTasks.delete(item)
                if (task.loaderTasks.size === 0) {
                  this.knowledgeItemProcessingQueueMappingPromise.delete(task)
                  resolve()
                }
                this.processingQueueHandle()
              }),
            resolve: () => {},
            evaluateTaskWorkload
          })
        }
      }
      return queueTaskList
    }
    const subTasks = getSubtasksUntilMaximumLoad()
    if (subTasks.length > 0) {
      const subTaskPromises = subTasks.map(({ taskPromise }) => taskPromise())
      Promise.all(subTaskPromises).then(() => {
        subTasks.forEach(({ resolve }) => resolve())
      })
    }
  }

  private appendProcessingQueue(task: LoaderTask): Promise<LoaderReturn> {
    return new Promise((resolve) => {
      this.knowledgeItemProcessingQueueMappingPromise.set(loaderTaskIntoOfSet(task), () => {
        resolve(task.loaderDoneReturn!)
      })
    })
  }

  public add = (_: Electron.IpcMainInvokeEvent, options: KnowledgeBaseAddItemOptions): Promise<LoaderReturn> => {
    return new Promise((resolve) => {
      const { base, item, forceReload = false, userId = '' } = options
      const optionsNonNullableAttribute = { base, item, forceReload, userId }
      this.getRagApplication(base)
        .then((ragApplication) => {
          const task = (() => {
            switch (item.type) {
              case 'file':
                return this.fileTask(ragApplication, optionsNonNullableAttribute)
              case 'directory':
                return this.directoryTask(ragApplication, optionsNonNullableAttribute)
              case 'url':
                return this.urlTask(ragApplication, optionsNonNullableAttribute)
              case 'sitemap':
                return this.sitemapTask(ragApplication, optionsNonNullableAttribute)
              case 'note':
                return this.noteTask(ragApplication, optionsNonNullableAttribute)
              default:
                return null
            }
          })()

          if (task) {
            this.appendProcessingQueue(task).then(() => {
              resolve(task.loaderDoneReturn!)
            })
            this.processingQueueHandle()
          } else {
            resolve({
              ...KnowledgeService.ERROR_LOADER_RETURN,
              message: 'Unsupported item type',
              messageSource: 'embedding'
            })
          }
        })
        .catch((err) => {
          logger.error('Failed to add item:', err)
          resolve({
            ...KnowledgeService.ERROR_LOADER_RETURN,
            message: `Failed to add item: ${err.message}`,
            messageSource: 'embedding'
          })
        })
    })
  }

  @TraceMethod({ spanName: 'remove', tag: 'Knowledge' })
  public async remove(
    _: Electron.IpcMainInvokeEvent,
    { uniqueId, uniqueIds, base }: { uniqueId: string; uniqueIds: string[]; base: KnowledgeBaseParams }
  ): Promise<void> {
    const ragApplication = await this.getRagApplication(base)
    logger.debug(`Remove Item UniqueId: ${uniqueId}`)
    for (const id of uniqueIds) {
      await ragApplication.deleteLoader(id)
    }
  }

  @TraceMethod({ spanName: 'RagSearch', tag: 'Knowledge' })
  public async search(
    _: Electron.IpcMainInvokeEvent,
    { search, base }: { search: string; base: KnowledgeBaseParams }
  ): Promise<ExtractChunkData[]> {
    const ragApplication = await this.getRagApplication(base)
    return await ragApplication.search(search)
  }

  @TraceMethod({ spanName: 'rerank', tag: 'Knowledge' })
  public async rerank(
    _: Electron.IpcMainInvokeEvent,
    { search, base, results }: { search: string; base: KnowledgeBaseParams; results: ExtractChunkData[] }
  ): Promise<ExtractChunkData[]> {
    if (results.length === 0) {
      return results
    }
    return await new Reranker(base).rerank(search, results)
  }

  public getStorageDir = (): string => {
    return this.storageDir
  }

  private preprocessing = async (
    file: FileMetadata,
    base: KnowledgeBaseParams,
    item: KnowledgeItem,
    userId: string
  ): Promise<FileMetadata> => {
    let fileToProcess: FileMetadata = file
    if (base.preprocessProvider && file.ext.toLowerCase() === '.pdf') {
      try {
        const provider = new PreprocessProvider(base.preprocessProvider.provider, userId)
        // Check if file has already been preprocessed
        const alreadyProcessed = await provider.checkIfAlreadyProcessed(file)
        if (alreadyProcessed) {
          logger.debug(`File already preprocess processed, using cached result: ${file.path}`)
          return alreadyProcessed
        }

        // Execute preprocessing
        logger.debug(`Starting preprocess processing for scanned PDF: ${file.path}`)
        const { processedFile, quota } = await provider.parseFile(item.id, file)
        fileToProcess = processedFile
        const mainWindow = windowService.getMainWindow()
        mainWindow?.webContents.send('file-preprocess-finished', {
          itemId: item.id,
          quota: quota
        })
      } catch (err) {
        logger.error(`Preprocess processing failed: ${err}`)
        // If preprocessing fails, use original file
        // fileToProcess = file
        throw new Error(`Preprocess processing failed: ${err}`)
      }
    }

    return fileToProcess
  }

  public checkQuota = async (
    _: Electron.IpcMainInvokeEvent,
    base: KnowledgeBaseParams,
    userId: string
  ): Promise<number> => {
    try {
      if (base.preprocessProvider && base.preprocessProvider.type === 'preprocess') {
        const provider = new PreprocessProvider(base.preprocessProvider.provider, userId)
        return await provider.checkQuota()
      }
      throw new Error('No preprocess provider configured')
    } catch (err) {
      logger.error(`Failed to check quota: ${err}`)
      throw new Error(`Failed to check quota: ${err}`)
    }
  }
}

export default new KnowledgeService()
