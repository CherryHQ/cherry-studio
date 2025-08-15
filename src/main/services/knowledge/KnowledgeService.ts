import * as fs from 'node:fs'
import path from 'node:path'

import { loggerService } from '@logger'
import { preprocessingService } from '@main/knowledge/preprocess/PreprocessingService'
import Reranker from '@main/knowledge/reranker/Reranker'
import { TraceMethod } from '@mcp-trace/trace-core'
import { MB } from '@shared/config/constant'
import { LoaderReturn } from '@shared/config/types'
import { KnowledgeBaseParams, KnowledgeSearchResult } from '@types'
import { app } from 'electron'

import {
  KnowledgeBaseAddItemOptions,
  LoaderTask,
  loaderTaskIntoOfSet,
  LoaderTaskItemState,
  LoaderTaskOfSet,
  QueueTaskItem
} from './IKnowledgeFramework'
import { knowledgeFrameworkFactory } from './KnowledgeFrameworkFactory'

const logger = loggerService.withContext('MainKnowledgeService')

class KnowledgeService {
  private storageDir = path.join(app.getPath('userData'), 'Data', 'KnowledgeBase')

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

  private maximumLoad() {
    return (
      this.processingItemCount >= KnowledgeService.MAXIMUM_PROCESSING_ITEM_COUNT ||
      this.workload >= KnowledgeService.MAXIMUM_WORKLOAD
    )
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

  public async create(_: Electron.IpcMainInvokeEvent, base: KnowledgeBaseParams): Promise<void> {
    logger.info(`Creating knowledge base: ${JSON.stringify(base)}`)
    const framework = knowledgeFrameworkFactory.getFramework(base)
    await framework.initialize(base)
  }
  public async reset(_: Electron.IpcMainInvokeEvent, { base }: { base: KnowledgeBaseParams }): Promise<void> {
    const framework = knowledgeFrameworkFactory.getFramework(base)
    await framework.reset(base)
  }

  public async delete(_: Electron.IpcMainInvokeEvent, base: KnowledgeBaseParams, id: string): Promise<void> {
    logger.info(`Deleting knowledge base: ${JSON.stringify(base)}`)
    const framework = knowledgeFrameworkFactory.getFramework(base)
    await framework.delete(id)
  }

  public add = async (_: Electron.IpcMainInvokeEvent, options: KnowledgeBaseAddItemOptions): Promise<LoaderReturn> => {
    logger.info(`Adding item to knowledge base: ${JSON.stringify(options)}`)
    return new Promise((resolve) => {
      const { base, item, forceReload = false, userId = '' } = options
      const framework = knowledgeFrameworkFactory.getFramework(base)

      const task = framework.getLoaderTask({ base, item, forceReload, userId })

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
  }

  public async remove(
    _: Electron.IpcMainInvokeEvent,
    { uniqueIds, base }: { uniqueIds: string[]; base: KnowledgeBaseParams }
  ): Promise<void> {
    logger.info(`Removing items from knowledge base: ${JSON.stringify({ uniqueIds, base })}`)
    const framework = knowledgeFrameworkFactory.getFramework(base)
    await framework.remove({ uniqueIds, base })
  }
  public async search(
    _: Electron.IpcMainInvokeEvent,
    { search, base }: { search: string; base: KnowledgeBaseParams }
  ): Promise<KnowledgeSearchResult[]> {
    logger.info(`Searching knowledge base: ${JSON.stringify({ search, base })}`)
    const framework = knowledgeFrameworkFactory.getFramework(base)
    return framework.search({ search, base })
  }

  @TraceMethod({ spanName: 'rerank', tag: 'Knowledge' })
  public async rerank(
    _: Electron.IpcMainInvokeEvent,
    { search, base, results }: { search: string; base: KnowledgeBaseParams; results: KnowledgeSearchResult[] }
  ): Promise<KnowledgeSearchResult[]> {
    logger.info(`Reranking knowledge base: ${JSON.stringify({ search, base, results })}`)
    if (results.length === 0) {
      return results
    }
    return await new Reranker(base).rerank(search, results)
  }

  public getStorageDir = (): string => {
    return this.storageDir
  }

  public async checkQuota(_: Electron.IpcMainInvokeEvent, base: KnowledgeBaseParams, userId: string): Promise<number> {
    return preprocessingService.checkQuota(base, userId)
  }
}

export default new KnowledgeService()
