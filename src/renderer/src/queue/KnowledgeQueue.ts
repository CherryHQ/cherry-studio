import db from '@renderer/databases'
import { getKnowledgeBaseParams } from '@renderer/services/KnowledgeService'
import store from '@renderer/store'
import { clearCompletedProcessing, updateBaseItemUniqueId, updateItemProcessingStatus } from '@renderer/store/knowledge'
import { KnowledgeItem } from '@renderer/types'
import type { LoaderReturn } from '@shared/config/types'

class KnowledgeQueue {
  private processing: Map<string, boolean> = new Map()
  private readonly MAX_RETRIES = 1

  constructor() {
    this.checkAllBases().catch(console.error)
  }

  public async checkAllBases(): Promise<void> {
    const state = store.getState()
    const bases = state.knowledge.bases

    await Promise.all(
      bases.map(async (base) => {
        const processableItems = base.items.filter((item) => {
          if (item.processingStatus === 'failed') {
            return !item.retryCount || item.retryCount < this.MAX_RETRIES
          }
          return item.processingStatus === 'pending'
        })

        const hasProcessableItems = processableItems.length > 0

        if (hasProcessableItems && !this.processing.get(base.id)) {
          await this.processQueue(base.id)
        }
      })
    )
  }

  async processQueue(baseId: string): Promise<void> {
    if (this.processing.get(baseId)) {
      console.log(`[KnowledgeQueue] Queue for base ${baseId} is already being processed`)
      return
    }

    this.processing.set(baseId, true)

    try {
      const state = store.getState()
      const base = state.knowledge.bases.find((b) => b.id === baseId)

      if (!base) {
        throw new Error('Knowledge base not found')
      }

      const processableItems = base.items.filter((item) => {
        if (item.processingStatus === 'failed') {
          return !item.retryCount || item.retryCount < this.MAX_RETRIES
        }
        return item.processingStatus === 'pending'
      })

      for (const item of processableItems) {
        if (!this.processing.get(baseId)) {
          console.log(`[KnowledgeQueue] Processing interrupted for base ${baseId}`)
          break
        }

        this.processItem(baseId, item)
      }
    } finally {
      console.log(`[KnowledgeQueue] Finished processing queue for base ${baseId}`)
      this.processing.set(baseId, false)
    }
  }

  stopProcessing(baseId: string): void {
    this.processing.set(baseId, false)
  }

  stopAllProcessing(): void {
    for (const baseId of this.processing.keys()) {
      this.processing.set(baseId, false)
    }
  }

  private async processItem(baseId: string, item: KnowledgeItem): Promise<void> {
    try {
      if (item.retryCount && item.retryCount >= this.MAX_RETRIES) {
        console.log(`[KnowledgeQueue] Item ${item.id} has reached max retries, skipping`)
        return
      }

      console.log(`[KnowledgeQueue] Starting to process item ${item.id} (${item.type})`)

      store.dispatch(
        updateItemProcessingStatus({
          baseId,
          itemId: item.id,
          status: 'processing',
          retryCount: (item.retryCount || 0) + 1
        })
      )

      const base = store.getState().knowledge.bases.find((b) => b.id === baseId)

      if (!base) {
        throw new Error(`[KnowledgeQueue] Knowledge base ${baseId} not found`)
      }

      const baseParams = getKnowledgeBaseParams(base)
      const sourceItem = base.items.find((i) => i.id === item.id)

      if (!sourceItem) {
        throw new Error(`[KnowledgeQueue] Source item ${item.id} not found in base ${baseId}`)
      }

      let result: LoaderReturn | null = null
      let note, content

      console.log(`[KnowledgeQueue] Processing item: ${sourceItem.content}`)

      switch (item.type) {
        case 'note':
          note = await db.knowledge_notes.get(item.id)
          if (note) {
            content = note.content as string
            result = await window.api.knowledgeBase.add({ base: baseParams, item: { ...sourceItem, content } })
          }
          break
        default:
          result = await window.api.knowledgeBase.add({ base: baseParams, item: sourceItem })
          break
      }

      console.log(`[KnowledgeQueue] Successfully completed processing item ${item.id}`)

      store.dispatch(
        updateItemProcessingStatus({
          baseId,
          itemId: item.id,
          status: 'completed'
        })
      )

      if (result) {
        store.dispatch(
          updateBaseItemUniqueId({
            baseId,
            itemId: item.id,
            uniqueId: result.uniqueId,
            uniqueIds: result.uniqueIds
          })
        )
      }
      console.debug(`[KnowledgeQueue] Updated uniqueId for item ${item.id} in base ${baseId} `)

      setTimeout(() => store.dispatch(clearCompletedProcessing({ baseId })), 1000)
    } catch (error) {
      console.error(`[KnowledgeQueue] Error processing item ${item.id}: `, error)
      store.dispatch(
        updateItemProcessingStatus({
          baseId,
          itemId: item.id,
          status: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error',
          retryCount: (item.retryCount || 0) + 1
        })
      )
    }
  }
}

export default new KnowledgeQueue()
