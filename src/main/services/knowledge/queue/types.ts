import type { KnowledgeBase } from '@shared/data/types/knowledge'

export interface KnowledgeQueueTaskEntry {
  base: KnowledgeBase
  baseId: string
  itemId: string
  kind: 'prepare-root' | 'index-leaf'
}

export interface KnowledgeQueueTaskContext extends KnowledgeQueueTaskEntry {
  /** Interruption waits for running work to observe this signal and settle. */
  signal: AbortSignal
  runWithBaseWriteLock<T>(task: () => Promise<T>): Promise<T>
}

export interface EnqueueKnowledgeTaskOptions extends KnowledgeQueueTaskEntry {
  execute: (context: KnowledgeQueueTaskContext) => Promise<void>
}

export interface KnowledgeQueueSnapshot {
  pending: KnowledgeQueueTaskEntry[]
  running: KnowledgeQueueTaskEntry[]
}
