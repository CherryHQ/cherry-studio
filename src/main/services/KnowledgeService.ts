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
import OcrProvider from '@main/knowledage/ocr/OcrProvider'
import PreprocessProvider from '@main/knowledage/preprocess/PreprocessProvider'
import Embeddings from '@main/knowledge/embeddings/Embeddings'
import { addFileLoader } from '@main/knowledge/loader'
import { NoteLoader } from '@main/knowledge/loader/noteLoader'
import Reranker from '@main/knowledge/reranker/Reranker'
import { windowService } from '@main/services/WindowService'
import { getDataPath } from '@main/utils'
import { getAllFiles } from '@main/utils/file'
import { MB } from '@shared/config/constant'
import type { LoaderReturn } from '@shared/config/types'
import { IpcChannel } from '@shared/IpcChannel'
import { FileMetadata, KnowledgeBaseParams, KnowledgeItem } from '@types'
import Logger from 'electron-log'
import { v4 as uuidv4 } from 'uuid'

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
  // Byte based
  private workload = 0
  private processingItemCount = 0
  private knowledgeItemProcessingQueueMappingPromise: Map<LoaderTaskOfSet, () => void> = new Map()
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
  }

  private initStorageDir = (): void => {
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true })
    }
  }

  private getRagApplication = async ({
    id,
    embedApiClient,
    dimensions,
    documentCount
  }: KnowledgeBaseParams): Promise<RAGApplication> => {
    let ragApplication: RAGApplication
    const embeddings = new Embeddings({
      embedApiClient,
      dimensions
    })
    try {
      ragApplication = await new RAGApplicationBuilder()
        .setModel('NO_MODEL')
        .setEmbeddingModel(embeddings)
        .setVectorDatabase(new LibSqlDb({ path: path.join(this.storageDir, id) }))
        .setSearchResultCount(documentCount || 30)
        .build()
    } catch (e) {
      Logger.error(e)
      throw new Error(`Failed to create RAGApplication: ${e}`)
    }

    return ragApplication
  }

  public create = async (_: Electron.IpcMainInvokeEvent, base: KnowledgeBaseParams): Promise<void> => {
    this.getRagApplication(base)
  }

  public reset = async (_: Electron.IpcMainInvokeEvent, base: KnowledgeBaseParams): Promise<void> => {
    const ragApplication = await this.getRagApplication(base)
    await ragApplication.reset()
  }

  public delete = async (_: Electron.IpcMainInvokeEvent, id: string): Promise<void> => {
    console.log('id', id)
    const dbPath = path.join(this.storageDir, id)
    if (fs.existsSync(dbPath)) {
      fs.rmSync(dbPath, { recursive: true })
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
              // 添加预处理逻辑
              const fileToProcess: FileMetadata = await this.preprocessing(file, base, item, userId)

              // 使用处理后的文件进行加载
              return addFileLoader(ragApplication, fileToProcess, base, forceReload)
                .then((result) => {
                  loaderTask.loaderDoneReturn = result
                  return result
                })
                .catch((e) => {
                  Logger.error(`Error in addFileLoader for ${file.name}: ${e}`)
                  const errorResult: LoaderReturn = {
                    ...KnowledgeService.ERROR_LOADER_RETURN,
                    message: e.message,
                    messageSource: 'embedding'
                  }
                  loaderTask.loaderDoneReturn = errorResult
                  return errorResult
                })
            } catch (e: any) {
              Logger.error(`Preprocessing failed for ${file.name}: ${e}`)
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
              Logger.error(err)
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
                Logger.error(err)
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
                Logger.error(err)
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
                Logger.error(err)
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

  public add = async (_: Electron.IpcMainInvokeEvent, options: KnowledgeBaseAddItemOptions): Promise<LoaderReturn> => {
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
          Logger.error(err)
          resolve({
            ...KnowledgeService.ERROR_LOADER_RETURN,
            message: `Failed to add item: ${err.message}`,
            messageSource: 'embedding'
          })
        })
    })
  }

  public remove = async (
    _: Electron.IpcMainInvokeEvent,
    { uniqueId, uniqueIds, base }: { uniqueId: string; uniqueIds: string[]; base: KnowledgeBaseParams }
  ): Promise<void> => {
    const ragApplication = await this.getRagApplication(base)
    Logger.log(`[ KnowledgeService Remove Item UniqueId: ${uniqueId}]`)
    for (const id of uniqueIds) {
      await ragApplication.deleteLoader(id)
    }
  }

  public search = async (
    _: Electron.IpcMainInvokeEvent,
    { search, base }: { search: string; base: KnowledgeBaseParams }
  ): Promise<ExtractChunkData[]> => {
    const ragApplication = await this.getRagApplication(base)
    return await ragApplication.search(search)
  }

  public rerank = async (
    _: Electron.IpcMainInvokeEvent,
    { search, base, results }: { search: string; base: KnowledgeBaseParams; results: ExtractChunkData[] }
  ): Promise<ExtractChunkData[]> => {
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
    if (base.preprocessOrOcrProvider && file.ext.toLowerCase() === '.pdf') {
      try {
        let provider: PreprocessProvider | OcrProvider
        if (base.preprocessOrOcrProvider.type === 'preprocess') {
          provider = new PreprocessProvider(base.preprocessOrOcrProvider.provider, userId)
        } else {
          provider = new OcrProvider(base.preprocessOrOcrProvider.provider)
        }
        // 首先检查文件是否已经被预处理过
        const alreadyProcessed = await provider.checkIfAlreadyProcessed(file)
        if (alreadyProcessed) {
          Logger.info(`File already preprocess processed, using cached result: ${file.path}`)
          return alreadyProcessed
        }

        // 执行预处理
        Logger.info(`Starting preprocess processing for scanned PDF: ${file.path}`)
        const { processedFile, quota } = await provider.parseFile(item.id, file)
        fileToProcess = processedFile
        const mainWindow = windowService.getMainWindow()
        mainWindow?.webContents.send('file-preprocess-finished', {
          itemId: item.id,
          quota: quota
        })
      } catch (err) {
        Logger.error(`Preprocess processing failed: ${err}`)
        // 如果预处理失败，使用原始文件
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
      if (base.preprocessOrOcrProvider && base.preprocessOrOcrProvider.type === 'preprocess') {
        const provider = new PreprocessProvider(base.preprocessOrOcrProvider.provider, userId)
        return await provider.checkQuota()
      }
      throw new Error('No preprocess provider configured')
    } catch (err) {
      Logger.error(`Failed to check quota: ${err}`)
      throw new Error(`Failed to check quota: ${err}`)
    }
  }
}

export default new KnowledgeService()
