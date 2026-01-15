/**
 * Type definitions and constants for KnowledgeQueueManager
 */

import type { KnowledgeItemType } from '@shared/data/types/knowledge'

import type { KnowledgeStageRunner } from '../types'

// ============================================================================
// Queue Status Types
// ============================================================================

export type QueueStatus = {
  queueSize: number
  processingCount: number
  perBaseQueue: Record<string, number>
}

// ============================================================================
// Scheduler Configuration
// ============================================================================

export type SchedulerConfig = {
  globalConcurrency: number
  perBaseConcurrency: number
  ioConcurrency: number
  embeddingConcurrency: number
  writeConcurrency: number
  maxQueueSize?: number
}

// ============================================================================
// Job Types
// ============================================================================

export type KnowledgeJob = {
  baseId: string
  itemId: string
  type?: KnowledgeItemType
  createdAt: number
}

export type KnowledgeJobTaskContext = {
  job: KnowledgeJob
  signal: AbortSignal
  runStage: KnowledgeStageRunner
  updateProgress: (progress: number, options?: { immediate?: boolean }) => void
}

export type KnowledgeJobTask<T> = (context: KnowledgeJobTaskContext) => Promise<T>

export type JobEntry<T> = {
  job: KnowledgeJob
  task: KnowledgeJobTask<T>
  controller: AbortController
  resolve: (result: T) => void
  reject: (error: Error) => void
}

// ============================================================================
// Constants
// ============================================================================

export const DEFAULT_SCHEDULER_CONFIG: SchedulerConfig = {
  globalConcurrency: 4,
  perBaseConcurrency: 2,
  ioConcurrency: 3,
  embeddingConcurrency: 3,
  writeConcurrency: 2
} as const

export const PROGRESS_THROTTLE_MS = 300
export const PROGRESS_TTL_MS = 5 * 60 * 1000
