import type { KnowledgeBase, KnowledgeItemOf, KnowledgeItemType } from '@shared/data/types/knowledge'

import type { IndexableKnowledgeItem } from '../types/items'

interface KnowledgeQueueBaseTaskEntry<TItem> {
  base: KnowledgeBase
  item: TItem
}

export interface IndexLeafTaskEntry extends KnowledgeQueueBaseTaskEntry<IndexableKnowledgeItem> {
  kind: 'index-leaf'
}

export interface PrepareRootTaskEntry
  extends KnowledgeQueueBaseTaskEntry<KnowledgeItemOf<'directory'> | KnowledgeItemOf<'sitemap'>> {
  kind: 'prepare-root'
}

export type KnowledgeQueueTaskEntry = IndexLeafTaskEntry | PrepareRootTaskEntry

export type KnowledgeQueueTaskContext<TEntry extends KnowledgeQueueTaskEntry = KnowledgeQueueTaskEntry> =
  TEntry extends KnowledgeQueueTaskEntry
    ? TEntry & {
        baseId: string
        itemId: string
        itemType: TEntry['item']['type']
        /** Interruption waits for running work to observe this signal and settle. */
        signal: AbortSignal
        runWithBaseWriteLock<T>(task: () => Promise<T>): Promise<T>
      }
    : never

export type EnqueueKnowledgeTaskOptions<TEntry extends KnowledgeQueueTaskEntry = KnowledgeQueueTaskEntry> =
  TEntry extends KnowledgeQueueTaskEntry
    ? TEntry & {
        execute: (context: KnowledgeQueueTaskContext<TEntry>) => Promise<void>
      }
    : never

export interface KnowledgeQueueTaskDescriptor {
  base: KnowledgeBase
  baseId: string
  itemId: string
  itemType: KnowledgeItemType
  kind: KnowledgeQueueTaskEntry['kind']
}

export interface KnowledgeQueueSnapshot {
  pending: KnowledgeQueueTaskDescriptor[]
  running: KnowledgeQueueTaskDescriptor[]
}
