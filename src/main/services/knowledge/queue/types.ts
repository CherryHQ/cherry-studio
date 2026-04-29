import type { KnowledgeBase } from '@shared/data/types/knowledge'

export interface KnowledgeQueueTaskEntry {
  base: KnowledgeBase
  baseId: string
  itemId: string
  kind: 'prepare-root' | 'index-leaf'
}

export interface KnowledgeQueueTaskContext extends KnowledgeQueueTaskEntry {
  /**
   * Running tasks must observe this signal. Queue reset/interruption waits for
   * running work to settle; it does not force-kill non-cooperative tasks.
   */
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
