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

import { LibSQLVectorStore } from '@langchain/community/vectorstores/libsql'
import { Document } from '@langchain/core/documents'
import { createClient } from '@libsql/client'
import Embeddings from '@main/knowledge/langchain/embeddings/Embeddings'
import { addFileLoader, addNoteLoader, addSitemapLoader, addWebLoader } from '@main/knowledge/langchain/loader'
import { RetrieverFactory } from '@main/knowledge/langchain/retriever'
import OcrProvider from '@main/knowledge/ocr/OcrProvider'
import PreprocessProvider from '@main/knowledge/preprocess/PreprocessProvider'
import Reranker from '@main/knowledge/reranker/Reranker'
import { windowService } from '@main/services/WindowService'
import { getAllFiles } from '@main/utils/file'
import { getUrlSource } from '@main/utils/knowledge'
import { TraceMethod } from '@mcp-trace/trace-core'
import { MB } from '@shared/config/constant'
import type { LoaderReturn } from '@shared/config/types'
import { IpcChannel } from '@shared/IpcChannel'
import { FileMetadata, KnowledgeBaseParams, KnowledgeItem, KnowledgeSearchResult } from '@types'
import { app } from 'electron'
import { v4 as uuidv4 } from 'uuid'

import { loggerService } from './LoggerService'

const logger = loggerService.withContext('KnowledgeService')

export interface KnowledgeBaseAddItemOptions {
  base: KnowledgeBaseParams
  item: KnowledgeItem
  forceReload?: boolean
}

interface KnowledgeBaseAddItemOptionsNonNullableAttribute {
  base: KnowledgeBaseParams
  item: KnowledgeItem
  forceReload: boolean
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

class NewKnowledgeService {
  private storageDir = path.join(app.getPath('userData'), 'Data', 'KnowledgeBase')
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

  private createDatabase = async ({ id, dimensions }: KnowledgeBaseParams) => {
    const client = createClient({
      url: `file:${path.join(this.storageDir, id)}`
    })

    await client.batch(
      [
        `CREATE TABLE IF NOT EXISTS Knowledge
            (
                id        INTEGER PRIMARY KEY AUTOINCREMENT,
                content   TEXT,
                metadata  TEXT,
                EMBEDDING_COLUMN F32_BLOB(${dimensions})
                );
              `,
        `CREATE INDEX IF NOT EXISTS idx_Knowledge_EMBEDDING_COLUMN ON Knowledge (libsql_vector_idx(EMBEDDING_COLUMN));`
      ],
      'write'
    )
  }

  private getVectorStore = async ({
    id,
    embedApiClient,
    dimensions
  }: KnowledgeBaseParams): Promise<LibSQLVectorStore> => {
    const embeddings = new Embeddings({
      embedApiClient,
      dimensions
    })
    const client = createClient({
      url: `file:${path.join(this.storageDir, id)}`
    })

    const vectorStore = new LibSQLVectorStore(embeddings, {
      db: client,
      table: 'Knowledge',
      column: 'EMBEDDING_COLUMN'
    })

    return vectorStore
  }

  public create = async (_: Electron.IpcMainInvokeEvent, base: KnowledgeBaseParams): Promise<void> => {
    this.createDatabase(base)
    this.getVectorStore(base)
  }

  public reset = async (_: Electron.IpcMainInvokeEvent, { base }: { base: KnowledgeBaseParams }): Promise<void> => {
    const vectorStore = await this.getVectorStore(base)
    await vectorStore.delete({ deleteAll: true })
  }

  public delete = async (_: Electron.IpcMainInvokeEvent, id: string): Promise<void> => {
    const dbPath = path.join(this.storageDir, id)
    if (fs.existsSync(dbPath)) {
      fs.rmSync(dbPath, { recursive: true })
    }
  }

  private maximumLoad() {
    return (
      this.processingItemCount >= NewKnowledgeService.MAXIMUM_PROCESSING_ITEM_COUNT ||
      this.workload >= NewKnowledgeService.MAXIMUM_WORKLOAD
    )
  }
  private fileTask(
    vectorStore: LibSQLVectorStore,
    options: KnowledgeBaseAddItemOptionsNonNullableAttribute
  ): LoaderTask {
    const { base, item } = options
    const file = item.content as FileMetadata

    const loaderTask: LoaderTask = {
      loaderTasks: [
        {
          state: LoaderTaskItemState.PENDING,
          task: async () => {
            try {
              // 添加预处理逻辑
              const fileToProcess: FileMetadata = await this.preprocessing(file, base, item)

              // 使用处理后的文件进行加载
              return addFileLoader(base, vectorStore, fileToProcess)
                .then((result) => {
                  loaderTask.loaderDoneReturn = result
                  return result
                })
                .catch((e) => {
                  logger.error(`Error in addFileLoader for ${file.name}: ${e}`)
                  const errorResult: LoaderReturn = {
                    ...NewKnowledgeService.ERROR_LOADER_RETURN,
                    message: e.message,
                    messageSource: 'embedding'
                  }
                  loaderTask.loaderDoneReturn = errorResult
                  return errorResult
                })
            } catch (e: any) {
              logger.error(`Preprocessing failed for ${file.name}: ${e}`)
              const errorResult: LoaderReturn = {
                ...NewKnowledgeService.ERROR_LOADER_RETURN,
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
    vectorStore: LibSQLVectorStore,
    options: KnowledgeBaseAddItemOptionsNonNullableAttribute
  ): LoaderTask {
    const { base, item } = options
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
          addFileLoader(base, vectorStore, file)
            .then((result) => {
              loaderDoneReturn.entriesAdded += 1
              processedFiles += 1
              sendDirectoryProcessingPercent(totalFiles, processedFiles)
              loaderDoneReturn.uniqueIds.push(result.uniqueId)
              return result
            })
            .catch((err) => {
              logger.error(err)
              return {
                ...NewKnowledgeService.ERROR_LOADER_RETURN,
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
    vectorStore: LibSQLVectorStore,
    options: KnowledgeBaseAddItemOptionsNonNullableAttribute
  ): LoaderTask {
    const { base, item } = options
    const url = item.content as string

    const loaderTask: LoaderTask = {
      loaderTasks: [
        {
          state: LoaderTaskItemState.PENDING,
          task: async () => {
            // 使用处理后的网页进行加载
            return addWebLoader(base, vectorStore, url, getUrlSource(url))
              .then((result) => {
                loaderTask.loaderDoneReturn = result
                return result
              })
              .catch((e) => {
                logger.error(`Error in addWebLoader for ${url}: ${e}`)
                const errorResult: LoaderReturn = {
                  ...NewKnowledgeService.ERROR_LOADER_RETURN,
                  message: e.message,
                  messageSource: 'embedding'
                }
                loaderTask.loaderDoneReturn = errorResult
                return errorResult
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
    vectorStore: LibSQLVectorStore,
    options: KnowledgeBaseAddItemOptionsNonNullableAttribute
  ): LoaderTask {
    const { base, item } = options
    const url = item.content as string

    const loaderTask: LoaderTask = {
      loaderTasks: [
        {
          state: LoaderTaskItemState.PENDING,
          task: async () => {
            // 使用处理后的网页进行加载
            return addSitemapLoader(base, vectorStore, url)
              .then((result) => {
                loaderTask.loaderDoneReturn = result
                return result
              })
              .catch((e) => {
                logger.error(`Error in addWebLoader for ${url}: ${e}`)
                const errorResult: LoaderReturn = {
                  ...NewKnowledgeService.ERROR_LOADER_RETURN,
                  message: e.message,
                  messageSource: 'embedding'
                }
                loaderTask.loaderDoneReturn = errorResult
                return errorResult
              })
          },
          evaluateTaskWorkload: { workload: 2 * MB }
        }
      ],
      loaderDoneReturn: null
    }
    return loaderTask
  }

  private noteTask(
    vectorStore: LibSQLVectorStore,
    options: KnowledgeBaseAddItemOptionsNonNullableAttribute
  ): LoaderTask {
    const { base, item } = options
    const content = item.content as string
    const sourceUrl = (item as any).sourceUrl

    logger.info(`noteTask ${content}, ${sourceUrl}`)

    const encoder = new TextEncoder()
    const contentBytes = encoder.encode(content)
    const loaderTask: LoaderTask = {
      loaderTasks: [
        {
          state: LoaderTaskItemState.PENDING,
          task: async () => {
            // 使用处理后的笔记进行加载
            return addNoteLoader(base, vectorStore, content, sourceUrl)
              .then((result) => {
                loaderTask.loaderDoneReturn = result
                return result
              })
              .catch((e) => {
                logger.error(`Error in addNoteLoader for ${sourceUrl}: ${e}`)
                const errorResult: LoaderReturn = {
                  ...NewKnowledgeService.ERROR_LOADER_RETURN,
                  message: e.message,
                  messageSource: 'embedding'
                }
                loaderTask.loaderDoneReturn = errorResult
                return errorResult
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
      const { base, item, forceReload = false } = options
      const optionsNonNullableAttribute = { base, item, forceReload }
      this.getVectorStore(base)
        .then((vectorStore) => {
          const task = (() => {
            switch (item.type) {
              case 'file':
                return this.fileTask(vectorStore, optionsNonNullableAttribute)
              case 'directory':
                return this.directoryTask(vectorStore, optionsNonNullableAttribute)
              case 'url':
                return this.urlTask(vectorStore, optionsNonNullableAttribute)
              case 'sitemap':
                return this.sitemapTask(vectorStore, optionsNonNullableAttribute)
              case 'note':
                return this.noteTask(vectorStore, optionsNonNullableAttribute)
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
              ...NewKnowledgeService.ERROR_LOADER_RETURN,
              message: 'Unsupported item type',
              messageSource: 'embedding'
            })
          }
        })
        .catch((err) => {
          logger.error(err)
          resolve({
            ...NewKnowledgeService.ERROR_LOADER_RETURN,
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
    const vectorStore = await this.getVectorStore(base)
    logger.info(`[ KnowledgeService Remove Item UniqueId: ${uniqueId}]`)

    await vectorStore.delete({ ids: uniqueIds })
  }

  @TraceMethod({ spanName: 'RagSearch', tag: 'Knowledge' })
  public async search(
    _: Electron.IpcMainInvokeEvent,
    { search, base }: { search: string; base: KnowledgeBaseParams }
  ): Promise<KnowledgeSearchResult[]> {
    logger.info(`search base: ${JSON.stringify(base)}`)

    const vectorStore = await this.getVectorStore(base)

    // 如果是 bm25 或 hybrid 模式，则从数据库获取所有文档
    let documents: Document[] = []
    if (base.retriever === 'bm25' || base.retriever === 'hybrid') {
      documents = await this.getAllDocuments(base)
    }

    const retrieverFactory = new RetrieverFactory()
    const retriever = retrieverFactory.createRetriever(base, vectorStore, documents)

    const results = await retriever.invoke(search)
    logger.info(`Search Results: ${JSON.stringify(results)}`)

    // VectorStoreRetriever 和 EnsembleRetriever 会将分数附加到 metadata.score
    // BM25Retriever 默认不返回分数，所以我们需要处理这种情况
    return results.map((item) => {
      return {
        pageContent: item.pageContent,
        metadata: item.metadata,
        // 如果 metadata 中没有 score，提供一个默认值
        score: typeof item.metadata.score === 'number' ? item.metadata.score : 0
      }
    })
  }

  @TraceMethod({ spanName: 'rerank', tag: 'Knowledge' })
  public async rerank(
    _: Electron.IpcMainInvokeEvent,
    { search, base, results }: { search: string; base: KnowledgeBaseParams; results: KnowledgeSearchResult[] }
  ): Promise<KnowledgeSearchResult[]> {
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
    item: KnowledgeItem
  ): Promise<FileMetadata> => {
    let fileToProcess: FileMetadata = file
    if (base.preprocessOrOcrProvider && file.ext.toLowerCase() === '.pdf') {
      try {
        let provider: PreprocessProvider | OcrProvider
        if (base.preprocessOrOcrProvider.type === 'preprocess') {
          provider = new PreprocessProvider(base.preprocessOrOcrProvider.provider)
        } else {
          provider = new OcrProvider(base.preprocessOrOcrProvider.provider)
        }
        // 首先检查文件是否已经被预处理过
        const alreadyProcessed = await provider.checkIfAlreadyProcessed(file)
        if (alreadyProcessed) {
          logger.info(`File already preprocess processed, using cached result: ${file.path}`)
          return alreadyProcessed
        }

        // 执行预处理
        logger.info(`Starting preprocess processing for scanned PDF: ${file.path}`)
        const { processedFile } = await provider.parseFile(item.id, file)
        fileToProcess = processedFile
        logger.warn(`base: ${base}, item: ${item}, file: ${file}`)
        const mainWindow = windowService.getMainWindow()
        mainWindow?.webContents.send('file-preprocess-finished', {
          itemId: item.id
        })
      } catch (err) {
        logger.error(`Preprocess processing failed: ${err}`)
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
      logger.error(`Failed to check quota: ${err}`)
      throw new Error(`Failed to check quota: ${err}`)
    }
  }

  private async getAllDocuments({ id }: KnowledgeBaseParams): Promise<Document[]> {
    logger.info(`Fetching all documents from database for knowledge base: ${id}`)
    const client = createClient({
      url: `file:${path.join(this.storageDir, id)}`
    })

    try {
      const resultSet = await client.execute('SELECT content, metadata FROM Knowledge')

      const documents: Document[] = []
      for (const row of resultSet.rows) {
        if (row.content && row.metadata) {
          try {
            const pageContent = row.content as string
            // metadata 在数据库中存储为 TEXT，需要解析回 JSON 对象
            const metadata = JSON.parse(row.metadata as string)
            documents.push(new Document({ pageContent, metadata }))
          } catch (e) {
            logger.error(`Failed to parse document row: ${e}`, row)
          }
        }
      }

      logger.info(`Fetched ${documents.length} documents for BM25/Hybrid retriever.`)
      return documents
    } catch (e) {
      logger.error(`Could not fetch documents from database for base ${id}: ${e}`)
      // 如果表不存在或查询失败，返回空数组
      return []
    }
  }
}

export default new NewKnowledgeService()
