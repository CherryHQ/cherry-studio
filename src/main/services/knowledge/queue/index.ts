/**
 * Knowledge Queue Module
 *
 * Provides job queue management with concurrency control for knowledge processing.
 */

// Main class and singleton
export { KnowledgeQueueManager, knowledgeQueueManager } from './KnowledgeQueueManager'

// Types
export type {
  JobEntry,
  KnowledgeJob,
  KnowledgeJobTask,
  KnowledgeJobTaskContext,
  QueueStatus,
  SchedulerConfig
} from './types'

// Constants
export { DEFAULT_SCHEDULER_CONFIG, PROGRESS_THROTTLE_MS, PROGRESS_TTL_MS } from './types'

// Helper classes (exported for potential reuse)
export { ConcurrencyPool } from './ConcurrencyPool'
export { ProgressTracker } from './ProgressTracker'
