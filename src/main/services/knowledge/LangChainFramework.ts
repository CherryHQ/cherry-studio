import * as fs from 'node:fs'
import path from 'node:path'

import { FaissStore } from '@langchain/community/vectorstores/faiss'
import type { Document } from '@langchain/core/documents'
import { loggerService } from '@logger'
import TextEmbeddings from '@main/knowledge/langchain/embeddings/TextEmbeddings'
import {
  addFileLoader,
  addNoteLoader,
  addSitemapLoader,
  addVideoLoader,
  addWebLoader
} from '@main/knowledge/langchain/loader'
import { RetrieverFactory } from '@main/knowledge/langchain/retriever'
import { preprocessingService } from '@main/knowledge/preprocess/PreprocessingService'
import { getAllFiles } from '@main/utils/file'
import { getUrlSource } from '@main/utils/knowledge'
import { MB } from '@shared/config/constant'
import { LoaderReturn } from '@shared/config/types'
import { IpcChannel } from '@shared/IpcChannel'
import {
  FileMetadata,
  isKnowledgeDirectoryItem,
  isKnowledgeFileItem,
  isKnowledgeNoteItem,
  isKnowledgeSitemapItem,
  isKnowledgeUrlItem,
  isKnowledgeVideoItem,
  KnowledgeBaseParams,
  KnowledgeSearchResult
} from '@types'
import { uuidv4 } from 'zod'

import { windowService } from '../WindowService'
import {
  IKnowledgeFramework,
  KnowledgeBaseAddItemOptionsNonNullableAttribute,
  LoaderDoneReturn,
  LoaderTask,
  LoaderTaskItem,
  LoaderTaskItemState
} from './IKnowledgeFramework'

const logger = loggerService.withContext('LangChainFramework')

export class LangChainFramework implements IKnowledgeFramework {
  private storageDir: string

  private static ERROR_LOADER_RETURN: LoaderReturn = {
    entriesAdded: 0,
    uniqueId: '',
    uniqueIds: [''],
    loaderType: '',
    status: 'failed'
  }

  constructor(storageDir: string) {
    this.storageDir = storageDir
    this.initStorageDir()
  }
  private initStorageDir = (): void => {
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true })
    }
  }

  private async createDatabase(base: KnowledgeBaseParams): Promise<void> {
    const dbPath = path.join(this.storageDir, base.id)
    const embeddings = this.getEmbeddings(base)
    const vectorStore = new FaissStore(embeddings, {})

    const mockDocument: Document = {
      pageContent: 'Create Database Document',
      metadata: {}
    }

    await vectorStore.addDocuments([mockDocument], { ids: ['1'] })
    await vectorStore.save(dbPath)
    await vectorStore.delete({ ids: ['1'] })
    await vectorStore.save(dbPath)
  }

  private getEmbeddings(base: KnowledgeBaseParams): TextEmbeddings {
    return new TextEmbeddings({
      embedApiClient: base.embedApiClient,
      dimensions: base.dimensions
    })
  }

  private async getVectorStore(base: KnowledgeBaseParams): Promise<FaissStore> {
    const embeddings = this.getEmbeddings(base)
    const vectorStore = await FaissStore.load(path.join(this.storageDir, base.id), embeddings)

    return vectorStore
  }

  async initialize(base: KnowledgeBaseParams): Promise<void> {
    await this.createDatabase(base)
  }
  async reset(base: KnowledgeBaseParams): Promise<void> {
    const dbPath = path.join(this.storageDir, base.id)
    if (fs.existsSync(dbPath)) {
      fs.rmSync(dbPath, { recursive: true })
    }
    // 立即重建空索引，避免随后加载时报错
    await this.createDatabase(base)
  }

  async delete(id: string): Promise<void> {
    const dbPath = path.join(this.storageDir, id)
    if (fs.existsSync(dbPath)) {
      fs.rmSync(dbPath, { recursive: true })
    }
  }
  getLoaderTask(options: KnowledgeBaseAddItemOptionsNonNullableAttribute): LoaderTask {
    const { item } = options
    const getStore = () => this.getVectorStore(options.base)
    switch (item.type) {
      case 'file':
        return this.fileTask(getStore, options)
      case 'directory':
        return this.directoryTask(getStore, options)
      case 'url':
        return this.urlTask(getStore, options)
      case 'sitemap':
        return this.sitemapTask(getStore, options)
      case 'note':
        return this.noteTask(getStore, options)
      case 'video':
        return this.videoTask(getStore, options)
      default:
        return {
          loaderTasks: [],
          loaderDoneReturn: null
        }
    }
  }
  async remove(options: { uniqueIds: string[]; base: KnowledgeBaseParams }): Promise<void> {
    const { uniqueIds, base } = options
    const vectorStore = await this.getVectorStore(base)
    logger.info(`[ KnowledgeService Remove Item UniqueIds: ${uniqueIds}]`)

    await vectorStore.delete({ ids: uniqueIds })
    await vectorStore.save(path.join(this.storageDir, base.id))
  }
  async search(options: { search: string; base: KnowledgeBaseParams }): Promise<KnowledgeSearchResult[]> {
    const { search, base } = options
    logger.info(`search base: ${JSON.stringify(base)}`)

    try {
      const vectorStore = await this.getVectorStore(base)

      // 如果是 bm25 或 hybrid 模式，则从数据库获取所有文档
      const documents: Document[] = await this.getAllDocuments(base)
      if (documents.length === 0) return []

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
    } catch (error: any) {
      logger.error(`Error during search in knowledge base ${base.id}: ${error.message}`)
      return []
    }
  }

  private fileTask(
    getVectorStore: () => Promise<FaissStore>,
    options: KnowledgeBaseAddItemOptionsNonNullableAttribute
  ): LoaderTask {
    const { base, item, userId } = options

    if (!isKnowledgeFileItem(item)) {
      logger.error(`Invalid item type for fileTask: expected 'file', got '${item.type}'`)
      return {
        loaderTasks: [],
        loaderDoneReturn: {
          ...LangChainFramework.ERROR_LOADER_RETURN,
          message: `Invalid item type: expected 'file', got '${item.type}'`,
          messageSource: 'validation'
        }
      }
    }

    const file = item.content

    const loaderTask: LoaderTask = {
      loaderTasks: [
        {
          state: LoaderTaskItemState.PENDING,
          task: async () => {
            try {
              const vectorStore = await getVectorStore()

              // 添加预处理逻辑
              const fileToProcess: FileMetadata = await preprocessingService.preprocessFile(file, base, item, userId)

              // 使用处理后的文件进行加载
              return addFileLoader(base, vectorStore, fileToProcess)
                .then((result) => {
                  loaderTask.loaderDoneReturn = result
                  return result
                })
                .then(async () => {
                  await vectorStore.save(path.join(this.storageDir, base.id))
                })
                .catch((e) => {
                  logger.error(`Error in addFileLoader for ${file.name}: ${e}`)
                  const errorResult: LoaderReturn = {
                    ...LangChainFramework.ERROR_LOADER_RETURN,
                    message: e.message,
                    messageSource: 'embedding'
                  }
                  loaderTask.loaderDoneReturn = errorResult
                  return errorResult
                })
            } catch (e: any) {
              logger.error(`Preprocessing failed for ${file.name}: ${e}`)
              const errorResult: LoaderReturn = {
                ...LangChainFramework.ERROR_LOADER_RETURN,
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
    getVectorStore: () => Promise<FaissStore>,
    options: KnowledgeBaseAddItemOptionsNonNullableAttribute
  ): LoaderTask {
    const { base, item } = options

    if (!isKnowledgeDirectoryItem(item)) {
      logger.error(`Invalid item type for directoryTask: expected 'directory', got '${item.type}'`)
      return {
        loaderTasks: [],
        loaderDoneReturn: {
          ...LangChainFramework.ERROR_LOADER_RETURN,
          message: `Invalid item type: expected 'directory', got '${item.type}'`,
          messageSource: 'validation'
        }
      }
    }

    const directory = item.content
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
          const vectorStore = await getVectorStore()
          return addFileLoader(base, vectorStore, file)
            .then((result) => {
              loaderDoneReturn.entriesAdded += 1
              processedFiles += 1
              sendDirectoryProcessingPercent(totalFiles, processedFiles)
              loaderDoneReturn.uniqueIds.push(result.uniqueId)
              return result
            })
            .then(async () => {
              await vectorStore.save(path.join(this.storageDir, base.id))
            })
            .catch((err) => {
              logger.error(err)
              return {
                ...LangChainFramework.ERROR_LOADER_RETURN,
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
    getVectorStore: () => Promise<FaissStore>,
    options: KnowledgeBaseAddItemOptionsNonNullableAttribute
  ): LoaderTask {
    const { base, item } = options

    if (!isKnowledgeUrlItem(item)) {
      logger.error(`Invalid item type for urlTask: expected 'url', got '${item.type}'`)
      return {
        loaderTasks: [],
        loaderDoneReturn: {
          ...LangChainFramework.ERROR_LOADER_RETURN,
          message: `Invalid item type: expected 'url', got '${item.type}'`,
          messageSource: 'validation'
        }
      }
    }

    const url = item.content

    const loaderTask: LoaderTask = {
      loaderTasks: [
        {
          state: LoaderTaskItemState.PENDING,
          task: async () => {
            // 使用处理后的网页进行加载
            const vectorStore = await getVectorStore()
            return addWebLoader(base, vectorStore, url, getUrlSource(url))
              .then((result) => {
                loaderTask.loaderDoneReturn = result
                return result
              })
              .then(async () => {
                await vectorStore.save(path.join(this.storageDir, base.id))
              })
              .catch((e) => {
                logger.error(`Error in addWebLoader for ${url}: ${e}`)
                const errorResult: LoaderReturn = {
                  ...LangChainFramework.ERROR_LOADER_RETURN,
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
    getVectorStore: () => Promise<FaissStore>,
    options: KnowledgeBaseAddItemOptionsNonNullableAttribute
  ): LoaderTask {
    const { base, item } = options

    if (!isKnowledgeSitemapItem(item)) {
      logger.error(`Invalid item type for sitemapTask: expected 'sitemap', got '${item.type}'`)
      return {
        loaderTasks: [],
        loaderDoneReturn: {
          ...LangChainFramework.ERROR_LOADER_RETURN,
          message: `Invalid item type: expected 'sitemap', got '${item.type}'`,
          messageSource: 'validation'
        }
      }
    }

    const url = item.content

    const loaderTask: LoaderTask = {
      loaderTasks: [
        {
          state: LoaderTaskItemState.PENDING,
          task: async () => {
            // 使用处理后的网页进行加载
            const vectorStore = await getVectorStore()
            return addSitemapLoader(base, vectorStore, url)
              .then((result) => {
                loaderTask.loaderDoneReturn = result
                return result
              })
              .then(async () => {
                await vectorStore.save(path.join(this.storageDir, base.id))
              })
              .catch((e) => {
                logger.error(`Error in addWebLoader for ${url}: ${e}`)
                const errorResult: LoaderReturn = {
                  ...LangChainFramework.ERROR_LOADER_RETURN,
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
    getVectorStore: () => Promise<FaissStore>,
    options: KnowledgeBaseAddItemOptionsNonNullableAttribute
  ): LoaderTask {
    const { base, item } = options

    if (!isKnowledgeNoteItem(item)) {
      logger.error(`Invalid item type for noteTask: expected 'note', got '${item.type}'`)
      return {
        loaderTasks: [],
        loaderDoneReturn: {
          ...LangChainFramework.ERROR_LOADER_RETURN,
          message: `Invalid item type: expected 'note', got '${item.type}'`,
          messageSource: 'validation'
        }
      }
    }

    const content = item.content
    const sourceUrl = item.sourceUrl ?? ''

    logger.info(`noteTask ${content}, ${sourceUrl}`)

    const encoder = new TextEncoder()
    const contentBytes = encoder.encode(content)
    const loaderTask: LoaderTask = {
      loaderTasks: [
        {
          state: LoaderTaskItemState.PENDING,
          task: async () => {
            // 使用处理后的笔记进行加载
            const vectorStore = await getVectorStore()
            return addNoteLoader(base, vectorStore, content, sourceUrl)
              .then((result) => {
                loaderTask.loaderDoneReturn = result
                return result
              })
              .then(async () => {
                await vectorStore.save(path.join(this.storageDir, base.id))
              })
              .catch((e) => {
                logger.error(`Error in addNoteLoader for ${sourceUrl}: ${e}`)
                const errorResult: LoaderReturn = {
                  ...LangChainFramework.ERROR_LOADER_RETURN,
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

  private videoTask(
    getVectorStore: () => Promise<FaissStore>,
    options: KnowledgeBaseAddItemOptionsNonNullableAttribute
  ): LoaderTask {
    const { base, item } = options

    if (!isKnowledgeVideoItem(item)) {
      logger.error(`Invalid item type for videoTask: expected 'video', got '${item.type}'`)
      return {
        loaderTasks: [],
        loaderDoneReturn: {
          ...LangChainFramework.ERROR_LOADER_RETURN,
          message: `Invalid item type: expected 'video', got '${item.type}'`,
          messageSource: 'validation'
        }
      }
    }

    const files = item.content

    const loaderTask: LoaderTask = {
      loaderTasks: [
        {
          state: LoaderTaskItemState.PENDING,
          task: async () => {
            const vectorStore = await getVectorStore()
            return addVideoLoader(base, vectorStore, files)
              .then((result) => {
                loaderTask.loaderDoneReturn = result
                return result
              })
              .then(async () => {
                await vectorStore.save(path.join(this.storageDir, base.id))
              })
              .catch((e) => {
                logger.error(`Preprocessing failed for ${files[0].name}: ${e}`)
                const errorResult: LoaderReturn = {
                  ...LangChainFramework.ERROR_LOADER_RETURN,
                  message: e.message,
                  messageSource: 'preprocess'
                }
                loaderTask.loaderDoneReturn = errorResult
                return errorResult
              })
          },
          evaluateTaskWorkload: { workload: files[0].size }
        }
      ],
      loaderDoneReturn: null
    }
    return loaderTask
  }

  private async getAllDocuments(base: KnowledgeBaseParams): Promise<Document[]> {
    logger.info(`Fetching all documents from database for knowledge base: ${base.id}`)

    try {
      const results = (await this.getVectorStore(base)).docstore._docs

      const documents: Document[] = Array.from(results.values())
      logger.info(`Fetched ${documents.length} documents for BM25/Hybrid retriever.`)
      return documents
    } catch (e) {
      logger.error(`Could not fetch documents from database for base ${base.id}: ${e}`)
      // 如果表不存在或查询失败，返回空数组
      return []
    }
  }
}
