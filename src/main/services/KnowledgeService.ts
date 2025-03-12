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

import { RAGApplication, RAGApplicationBuilder, TextLoader } from '@llm-tools/embedjs'
import type { ExtractChunkData } from '@llm-tools/embedjs-interfaces'
import { LibSqlDb } from '@llm-tools/embedjs-libsql'
import { SitemapLoader } from '@llm-tools/embedjs-loader-sitemap'
import { WebLoader } from '@llm-tools/embedjs-loader-web'
import { AzureOpenAiEmbeddings, OpenAiEmbeddings } from '@llm-tools/embedjs-openai'
import { addFileLoader } from '@main/loader'
import { proxyManager } from '@main/services/ProxyManager'
import { windowService } from '@main/services/WindowService'
import { getInstanceName } from '@main/utils'
import { getAllFiles } from '@main/utils/file'
import type { LoaderReturn } from '@shared/config/types'
import { FileType, KnowledgeBaseParams, KnowledgeItem } from '@types'
import { app } from 'electron'
import Logger from 'electron-log'
import { v4 as uuidv4 } from 'uuid'

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

class KnowledgeService {
  private storageDir = path.join(app.getPath('userData'), 'Data', 'KnowledgeBase')
  // Byte based
  private workload = 0
  private processingItemCount = 0
  private knowledgeItemProcessingQueueMappingPromise: Map<LoaderTaskOfSet, () => void> = new Map()
  private static MAXIMUM_WORKLOAD = 1024 * 1024 * 80
  private static MAXIMUM_PROCESSING_ITEM_COUNT = 30
  private static ERROR_LOADER_RETURN: LoaderReturn = { entriesAdded: 0, uniqueId: '', uniqueIds: [''], loaderType: '' }

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
              configuration: { httpAgent: proxyManager.getProxyAgent() },
              dimensions,
              batchSize
            })
          : new OpenAiEmbeddings({
              model,
              apiKey,
              configuration: { baseURL, httpAgent: proxyManager.getProxyAgent() },
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
    const { base, item, forceReload } = options
    const file = item.content as FileType

    const loaderTask: LoaderTask = {
      loaderTasks: [
        {
          state: LoaderTaskItemState.PENDING,
          task: () =>
            addFileLoader(ragApplication, file, base, forceReload)
              .then((result) => {
                loaderTask.loaderDoneReturn = result
                return result
              })
              .catch((err) => {
                Logger.error(err)
                return KnowledgeService.ERROR_LOADER_RETURN
              }),
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
      mainWindow?.webContents.send('directory-processing-percent', {
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
              return KnowledgeService.ERROR_LOADER_RETURN
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
                return KnowledgeService.ERROR_LOADER_RETURN
              })
          },
          evaluateTaskWorkload: { workload: 1024 * 1024 * 2 }
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
                return KnowledgeService.ERROR_LOADER_RETURN
              }),
          evaluateTaskWorkload: { workload: 1024 * 1024 * 20 }
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
    console.debug('chunkSize', base.chunkSize)

    const encoder = new TextEncoder()
    const contentBytes = encoder.encode(content)
    const loaderTask: LoaderTask = {
      loaderTasks: [
        {
          state: LoaderTaskItemState.PENDING,
          task: () => {
            const loaderReturn = ragApplication.addLoader(
              new TextLoader({ text: content, chunkSize: base.chunkSize, chunkOverlap: base.chunkOverlap }),
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
                return KnowledgeService.ERROR_LOADER_RETURN
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
    proxyManager.setGlobalProxy()
    return new Promise((resolve) => {
      const { base, item, forceReload = false } = options
      const optionsNonNullableAttribute = { base, item, forceReload }
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
            resolve(KnowledgeService.ERROR_LOADER_RETURN)
          }
        })
        .catch((err) => {
          Logger.error(err)
          resolve(KnowledgeService.ERROR_LOADER_RETURN)
        })
    })
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
  }

  // 添加超时设置的Promise包装函数
  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorMessage: string): Promise<T> {
    let timeoutId: NodeJS.Timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(errorMessage))
      }, timeoutMs)
    })

    try {
      const result = await Promise.race([promise, timeoutPromise])
      clearTimeout(timeoutId!)
      return result as T
    } catch (error) {
      clearTimeout(timeoutId!)
      throw error
    }
  }

  // 检查知识库是否存在且有效
  private checkKnowledgeBaseExists(id: string): boolean {
    const dbPath = path.join(this.storageDir, id)
    if (!fs.existsSync(dbPath)) {
      Logger.warn(`[KnowledgeService] 知识库目录不存在: ${dbPath}`)
      return false
    }

    // 检查是否有关键的数据库文件
    const dbFile = path.join(dbPath, 'data.sqlite')
    if (!fs.existsSync(dbFile)) {
      Logger.warn(`[KnowledgeService] 知识库数据库文件不存在: ${dbFile}`)
      return false
    }

    try {
      // 检查文件大小，如果文件过小可能是空数据库
      const stats = fs.statSync(dbFile)
      if (stats.size < 4000) {
        // 假设一个最小有效的SQLite数据库应该至少有4KB
        Logger.warn(`[KnowledgeService] 知识库数据库可能为空，大小: ${stats.size} 字节`)
        return false
      }

      return true
    } catch (error) {
      Logger.error(`[KnowledgeService] 检查知识库时出错: ${error}`)
      return false
    }
  }

  public search = async (
    event: Electron.IpcMainInvokeEvent,
    { search, base }: { search: string; base: KnowledgeBaseParams }
  ): Promise<ExtractChunkData[]> => {
    try {
      // 设置代理以确保网络连接
      proxyManager.setGlobalProxy()

      // 先检查存储目录是否存在，避免后续操作出错
      this.initStorageDir()

      // 先检查知识库是否存在且有效
      if (!this.checkKnowledgeBaseExists(base.id)) {
        Logger.warn(`[KnowledgeService] 知识库不存在或为空: ${base.id}`)

        if (event.sender) {
          event.sender.send('knowledge-base:search-error', {
            message: `搜索失败: 知识库不存在或为空`,
            details: `Knowledge base ID: ${base.id}`
          })
        }

        return []
      }

      Logger.info(
        `[KnowledgeService] 正在搜索知识库 ${base.id}, 查询: "${search.substring(0, 50)}${search.length > 50 ? '...' : ''}"`
      )

      // 获取RAG应用实例，添加超时机制，延长超时时间
      const ragApplicationPromise = this.getRagApplication(base)
      const ragApplication = await this.withTimeout(
        ragApplicationPromise,
        20000, // 增加到20秒超时
        '获取RAG应用实例超时'
      )

      // 执行搜索并返回结果，添加超时机制，延长超时时间
      const searchPromise = ragApplication.search(search)
      const result = await this.withTimeout(
        searchPromise,
        40000, // 增加到40秒超时
        '知识库搜索超时'
      )

      Logger.info(`[KnowledgeService] 搜索完成，找到 ${result.length} 个结果`)
      return result
    } catch (error) {
      // 记录详细错误日志
      const errorMessage = error instanceof Error ? error.message : String(error)
      const errorStack = error instanceof Error ? error.stack : ''
      Logger.error(`[KnowledgeService] Search error: ${errorMessage}`)
      if (errorStack) {
        Logger.error(`[KnowledgeService] Error stack: ${errorStack}`)
      }

      // 通过事件发送方发送错误通知，并提供更明确的错误信息
      if (event.sender) {
        let userFriendlyMessage = '连接错误'
        if (errorMessage.includes('timeout') || errorMessage.includes('超时')) {
          userFriendlyMessage = '搜索超时，请稍后再试'
        } else if (errorMessage.includes('network') || errorMessage.includes('网络')) {
          userFriendlyMessage = '网络连接失败，请检查网络设置'
        }

        event.sender.send('knowledge-base:search-error', {
          message: `搜索失败: ${userFriendlyMessage}`,
          details: errorMessage
        })
      }

      // 返回空结果而不是抛出错误，这样应用可以继续运行
      return []
    }
  }
}

export default new KnowledgeService()
