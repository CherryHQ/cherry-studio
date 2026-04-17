/**
 * AutoRetainScheduler — debounces and batches memory retain calls triggered
 * at the end of each AI turn (onRequestEnd hook in searchOrchestrationPlugin).
 *
 * Behaviour:
 *  - Retain calls are buffered per userId.
 *  - Flushed when buffer reaches auto_retain_batch_size OR after
 *    auto_retain_debounce_ms of inactivity, whichever comes first.
 *  - For Hindsight (serverSideExtraction=true): passes raw turn content;
 *    the server extracts and stores facts.
 *  - For LibSql (serverSideExtraction=false): caller must pass pre-extracted
 *    facts (MemoryProcessor responsibility).
 *  - Errors are caught and logged; never propagate to the LLM turn.
 */

import { loggerService } from '@logger'
import { memoryService } from '@renderer/services/MemoryService'
import type { MemoryEntity } from '@shared/memory'

const logger = loggerService.withContext('AutoRetainScheduler')

interface PendingEntry {
  content: string
  timestamp: string
  entity: MemoryEntity
}

class AutoRetainScheduler {
  private readonly buffers = new Map<string, PendingEntry[]>()
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()

  /**
   * Schedule content for retention.
   * @param content  Raw turn content or extracted fact.
   * @param entity   Scope entity (userId, agentId, topicId).
   * @param debounceMs  Debounce interval in ms.
   * @param batchSize   Max entries before an immediate flush.
   */
  schedule(content: string, entity: MemoryEntity, debounceMs: number, batchSize: number): void {
    if (!content.trim()) return

    const key = this.bufferKey(entity)
    const buffer = this.buffers.get(key) ?? []
    buffer.push({ content, timestamp: new Date().toISOString(), entity })
    this.buffers.set(key, buffer)

    if (buffer.length >= batchSize) {
      this.flush(key)
      return
    }

    // Reset debounce timer.
    const existing = this.timers.get(key)
    if (existing) clearTimeout(existing)
    this.timers.set(
      key,
      setTimeout(() => this.flush(key), debounceMs)
    )
  }

  /** Flush immediately (e.g., on conversation end). */
  flushAll(): void {
    for (const key of this.buffers.keys()) {
      this.flush(key)
    }
  }

  private flush(key: string): void {
    const timer = this.timers.get(key)
    if (timer) {
      clearTimeout(timer)
      this.timers.delete(key)
    }

    const buffer = this.buffers.get(key) ?? []
    if (buffer.length === 0) return
    this.buffers.delete(key)

    const contents = buffer.map((e) => e.content)
    const entity = buffer[0].entity

    // Fire-and-forget: never block the caller.
    memoryService
      .add(contents, {
        userId: entity.userId,
        agentId: entity.agentId,
        topicId: entity.topicId,
        timestamp: buffer[0].timestamp
      })
      .catch((err: unknown) => {
        logger.warn(
          'AutoRetainScheduler: retain failed (non-blocking)',
          err instanceof Error ? err : new Error(String(err))
        )
      })
  }

  private bufferKey(entity: MemoryEntity): string {
    return [entity.userId ?? '_', entity.agentId ?? '_', entity.topicId ?? '_'].join(':')
  }
}

/** Singleton scheduler — shared across all plugin instances. */
export const autoRetainScheduler = new AutoRetainScheduler()
