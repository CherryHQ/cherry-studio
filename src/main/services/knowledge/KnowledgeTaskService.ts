import { knowledgeItemTable } from '@data/db/schemas/knowledge'
import { loggerService } from '@logger'
import { application } from '@main/core/application'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { knowledgeItemService } from '@main/data/services/KnowledgeItemService'
import type { KnowledgeItemStatus } from '@shared/data/types/knowledge'
import { inArray } from 'drizzle-orm'

import {
  type KnowledgeExecutionResult,
  knowledgeExecutionService,
  type KnowledgeExecutionStage,
  type KnowledgeExecutionTask
} from './KnowledgeExecutionService'

const logger = loggerService.withContext('KnowledgeTaskService')

const INTERRUPTED_ITEM_STATUSES = [
  'pending',
  'file_processing',
  'embed'
] as const satisfies readonly KnowledgeItemStatus[]
const STARTUP_INTERRUPTED_REASON = 'Knowledge task interrupted before scheduler startup'
const SHUTDOWN_INTERRUPTED_REASON = 'Knowledge task interrupted by scheduler shutdown'

export interface EnqueueKnowledgeTaskInput {
  itemId: string
  baseId: string
  stage: KnowledgeExecutionStage
  readyAt?: number
}

interface KnowledgeTaskRecord extends KnowledgeExecutionTask {
  createdAt: number
}

@Injectable('KnowledgeTaskService')
@ServicePhase(Phase.Background)
export class KnowledgeTaskService extends BaseService {
  private readonly maxConcurrentItems = 3
  private readonly maxConcurrentPerBase = 1

  private pendingQueues = new Map<string, KnowledgeTaskRecord[]>()
  private pendingItemIds = new Set<string>()
  private runningTasks = new Map<string, KnowledgeTaskRecord>()
  private runningCountByBase = new Map<string, number>()
  private runningGlobalCount = 0
  private baseOrder: string[] = []
  private scheduleTimer: ReturnType<typeof setTimeout> | null = null
  private isScheduling = false
  private scheduleRequested = false
  private isShuttingDown = false

  protected async onInit(): Promise<void> {
    await this.failInterruptedPersistedTasks(STARTUP_INTERRUPTED_REASON)
  }

  protected async onStop(): Promise<void> {
    this.isShuttingDown = true
    this.clearScheduleTimer()

    const interruptedItemIds = Array.from(this.collectInterruptedItemIds())
    this.resetInMemoryState()

    await this.failItems(interruptedItemIds, SHUTDOWN_INTERRUPTED_REASON)
  }

  public async enqueueMany(tasks: EnqueueKnowledgeTaskInput[]): Promise<void> {
    if (this.isShuttingDown || tasks.length === 0) {
      return
    }

    const reservedItemIds = new Set([...this.pendingItemIds, ...this.runningTasks.keys()])
    const acceptedTasks: KnowledgeTaskRecord[] = []

    for (const task of tasks) {
      if (reservedItemIds.has(task.itemId)) {
        continue
      }

      reservedItemIds.add(task.itemId)
      acceptedTasks.push(this.createTaskRecord(task))
    }

    if (acceptedTasks.length === 0) {
      return
    }

    const persistedResults = await Promise.allSettled(
      acceptedTasks.map((task) =>
        knowledgeItemService.update(task.itemId, {
          status: 'pending',
          error: null
        })
      )
    )

    let enqueuedCount = 0

    for (const [index, result] of persistedResults.entries()) {
      if (result.status === 'rejected') {
        logger.error(
          'Failed to persist knowledge item pending state before enqueue',
          result.reason instanceof Error ? result.reason : new Error(String(result.reason)),
          { itemId: acceptedTasks[index].itemId, baseId: acceptedTasks[index].baseId }
        )
        continue
      }

      this.enqueueRecord(acceptedTasks[index])
      enqueuedCount += 1
    }

    if (enqueuedCount > 0) {
      this.requestSchedule()
    }
  }

  private createTaskRecord(task: EnqueueKnowledgeTaskInput | KnowledgeExecutionTask): KnowledgeTaskRecord {
    const now = Date.now()

    return {
      itemId: task.itemId,
      baseId: task.baseId,
      stage: task.stage,
      readyAt: task.readyAt ?? now,
      createdAt: now
    }
  }

  private enqueueRecord(task: KnowledgeTaskRecord): void {
    if (this.pendingItemIds.has(task.itemId) || this.runningTasks.has(task.itemId)) {
      return
    }

    const queue = this.pendingQueues.get(task.baseId)

    if (queue) {
      queue.push(task)
    } else {
      this.pendingQueues.set(task.baseId, [task])
      this.baseOrder.push(task.baseId)
    }

    this.pendingItemIds.add(task.itemId)
  }

  private requestSchedule(): void {
    if (this.isShuttingDown) {
      return
    }

    if (this.isScheduling) {
      this.scheduleRequested = true
      return
    }

    void this.schedule()
  }

  private async schedule(): Promise<void> {
    if (this.isShuttingDown) {
      return
    }

    if (this.isScheduling) {
      this.scheduleRequested = true
      return
    }

    this.isScheduling = true

    try {
      this.clearScheduleTimer()

      while (!this.isShuttingDown && this.runningGlobalCount < this.maxConcurrentItems) {
        const task = this.dequeueNextReadyTask()

        if (!task) {
          break
        }

        this.startTask(task)
      }

      if (!this.isShuttingDown) {
        this.armNextScheduleTimer()
      }
    } finally {
      this.isScheduling = false

      if (this.scheduleRequested && !this.isShuttingDown) {
        this.scheduleRequested = false
        void this.schedule()
      }
    }
  }

  private dequeueNextReadyTask(): KnowledgeTaskRecord | null {
    const now = Date.now()
    let remainingBases = this.baseOrder.length

    while (remainingBases > 0) {
      const baseId = this.baseOrder.shift()

      if (!baseId) {
        return null
      }

      remainingBases -= 1

      if ((this.runningCountByBase.get(baseId) ?? 0) >= this.maxConcurrentPerBase) {
        this.baseOrder.push(baseId)
        continue
      }

      const queue = this.pendingQueues.get(baseId)

      if (!queue || queue.length === 0) {
        this.pendingQueues.delete(baseId)
        continue
      }

      const task = queue[0]

      if (task.readyAt > now) {
        this.baseOrder.push(baseId)
        continue
      }

      queue.shift()
      this.pendingItemIds.delete(task.itemId)

      if (queue.length > 0) {
        this.baseOrder.push(baseId)
      } else {
        this.pendingQueues.delete(baseId)
      }

      return task
    }

    return null
  }

  private startTask(task: KnowledgeTaskRecord): void {
    this.runningTasks.set(task.itemId, task)
    this.runningGlobalCount += 1
    this.runningCountByBase.set(task.baseId, (this.runningCountByBase.get(task.baseId) ?? 0) + 1)

    void this.executeTask(task)
  }

  private async executeTask(task: KnowledgeTaskRecord): Promise<void> {
    let result: KnowledgeExecutionResult

    try {
      result = await knowledgeExecutionService.execute(task)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)

      logger.error('Knowledge task execution threw unexpectedly', error instanceof Error ? error : new Error(message), {
        itemId: task.itemId,
        baseId: task.baseId,
        stage: task.stage
      })

      result = {
        type: 'failed',
        error: message
      }
    }

    this.finishRunningTask(task)
    await this.handleExecutionResult(result)
    this.requestSchedule()
  }

  private finishRunningTask(task: KnowledgeTaskRecord): void {
    this.runningTasks.delete(task.itemId)
    this.runningGlobalCount = Math.max(0, this.runningGlobalCount - 1)

    const nextRunningCount = Math.max(0, (this.runningCountByBase.get(task.baseId) ?? 0) - 1)

    if (nextRunningCount === 0) {
      this.runningCountByBase.delete(task.baseId)
    } else {
      this.runningCountByBase.set(task.baseId, nextRunningCount)
    }
  }

  private async handleExecutionResult(result: KnowledgeExecutionResult): Promise<void> {
    switch (result.type) {
      case 'completed':
      case 'failed':
        return
      case 'next':
        if (this.isShuttingDown) {
          return
        }

        this.enqueueRecord(this.createTaskRecord(result.task))
        return
    }
  }

  private armNextScheduleTimer(): void {
    const nextReadyAt = this.findNextReadyAt()

    if (nextReadyAt == null) {
      return
    }

    const delay = Math.max(0, nextReadyAt - Date.now())

    this.scheduleTimer = setTimeout(() => {
      this.scheduleTimer = null
      this.requestSchedule()
    }, delay)
  }

  private findNextReadyAt(): number | null {
    let nextReadyAt: number | null = null
    const now = Date.now()

    for (const queue of this.pendingQueues.values()) {
      const task = queue[0]

      if (!task || task.readyAt <= now) {
        continue
      }

      if (nextReadyAt == null || task.readyAt < nextReadyAt) {
        nextReadyAt = task.readyAt
      }
    }

    return nextReadyAt
  }

  private clearScheduleTimer(): void {
    if (!this.scheduleTimer) {
      return
    }

    clearTimeout(this.scheduleTimer)
    this.scheduleTimer = null
  }

  private async failInterruptedPersistedTasks(reason: string): Promise<void> {
    const db = application.get('DbService').getDb()
    const interruptedItems = await db
      .select({ id: knowledgeItemTable.id })
      .from(knowledgeItemTable)
      .where(inArray(knowledgeItemTable.status, [...INTERRUPTED_ITEM_STATUSES]))

    await this.failItems(
      interruptedItems.map((item) => item.id),
      reason
    )
  }

  private collectInterruptedItemIds(): Set<string> {
    const itemIds = new Set<string>()

    for (const queue of this.pendingQueues.values()) {
      for (const task of queue) {
        itemIds.add(task.itemId)
      }
    }

    for (const task of this.runningTasks.values()) {
      itemIds.add(task.itemId)
    }

    return itemIds
  }

  private async failItems(itemIds: string[], reason: string): Promise<void> {
    if (itemIds.length === 0) {
      return
    }

    const uniqueItemIds = Array.from(new Set(itemIds))
    const results = await Promise.allSettled(
      uniqueItemIds.map((itemId) =>
        knowledgeItemService.update(itemId, {
          status: 'failed',
          error: reason
        })
      )
    )

    for (const [index, result] of results.entries()) {
      if (result.status === 'fulfilled') {
        continue
      }

      logger.error(
        'Failed to persist knowledge item interrupted state',
        result.reason instanceof Error ? result.reason : new Error(String(result.reason)),
        { itemId: uniqueItemIds[index], reason }
      )
    }
  }

  private resetInMemoryState(): void {
    this.pendingQueues.clear()
    this.pendingItemIds.clear()
    this.runningTasks.clear()
    this.runningCountByBase.clear()
    this.runningGlobalCount = 0
    this.baseOrder = []
    this.scheduleRequested = false
  }
}
