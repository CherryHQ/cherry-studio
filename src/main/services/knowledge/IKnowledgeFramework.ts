import { LoaderReturn } from '@shared/config/types'
import { KnowledgeBaseParams, KnowledgeItem, KnowledgeSearchResult } from '@types'

export interface KnowledgeBaseAddItemOptions {
  base: KnowledgeBaseParams
  item: KnowledgeItem
  forceReload?: boolean
  userId?: string
}

export interface KnowledgeBaseAddItemOptionsNonNullableAttribute {
  base: KnowledgeBaseParams
  item: KnowledgeItem
  forceReload: boolean
  userId: string
}

export interface EvaluateTaskWorkload {
  workload: number
}

export type LoaderDoneReturn = LoaderReturn | null

export enum LoaderTaskItemState {
  PENDING,
  PROCESSING,
  DONE
}

export interface LoaderTaskItem {
  state: LoaderTaskItemState
  task: () => Promise<unknown>
  evaluateTaskWorkload: EvaluateTaskWorkload
}

export interface LoaderTask {
  loaderTasks: LoaderTaskItem[]
  loaderDoneReturn: LoaderDoneReturn
}

export interface LoaderTaskOfSet {
  loaderTasks: Set<LoaderTaskItem>
  loaderDoneReturn: LoaderDoneReturn
}

export interface QueueTaskItem {
  taskPromise: () => Promise<unknown>
  resolve: () => void
  evaluateTaskWorkload: EvaluateTaskWorkload
}

export const loaderTaskIntoOfSet = (loaderTask: LoaderTask): LoaderTaskOfSet => {
  return {
    loaderTasks: new Set(loaderTask.loaderTasks),
    loaderDoneReturn: loaderTask.loaderDoneReturn
  }
}

export interface IKnowledgeFramework {
  /** 为给定知识库初始化框架资源 */
  initialize(base: KnowledgeBaseParams): Promise<void>
  /** 重置知识库，删除其所有内容 */
  reset(base: KnowledgeBaseParams): Promise<void>
  /** 删除与知识库关联的资源，包括文件 */
  delete(id: string): Promise<void>
  /** 生成用于添加条目的任务对象，由队列处理 */
  getLoaderTask(options: KnowledgeBaseAddItemOptionsNonNullableAttribute): LoaderTask
  /** 从知识库中删除特定条目 */
  remove(options: { uniqueIds: string[]; base: KnowledgeBaseParams }): Promise<void>
  /** 搜索知识库 */
  search(options: { search: string; base: KnowledgeBaseParams }): Promise<KnowledgeSearchResult[]>
}
