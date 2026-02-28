/**
 * Periodic Task Manager Types
 * Manages scheduled tasks that can call agents/assistants
 */

/**
 * Task execution status
 */
export type TaskStatus = 'idle' | 'running' | 'completed' | 'failed' | 'paused'

/**
 * Schedule type for periodic tasks
 */
export type ScheduleType = 'once' | 'interval' | 'cron' | 'manual'

/**
 * Schedule configuration
 */
export interface TaskSchedule {
  type: ScheduleType
  /** For 'interval': milliseconds between runs */
  interval?: number
  /** For 'cron': cron expression (e.g., "0 9 * * *" for daily at 9am) */
  cronExpression?: string
  /** Human-readable description */
  description: string
}

/**
 * Task target - can be an agent, assistant, or session
 */
export type TaskTarget = {
  type: 'agent' | 'assistant' | 'agent_session'
  id: string
  name: string
}

/**
 * Execution configuration for a task
 */
export interface TaskExecutionConfig {
  /** Message to send to the agent/assistant */
  message: string
  /** Whether to continue conversation from previous run */
  continueConversation: boolean
  /** Maximum execution time in seconds */
  maxExecutionTime?: number
  /** Whether to send notification on completion */
  notifyOnComplete: boolean
}

/**
 * Task execution history
 */
export interface TaskExecution {
  id: string
  taskId: string
  status: TaskStatus
  startedAt: string
  completedAt?: string
  result?: {
    success: boolean
    output?: string
    error?: string
    duration?: number
    metadata?: Record<string, unknown>
  }
}

/**
 * Periodic Task entity
 */
export interface PeriodicTask {
  id: string
  name: string
  description?: string
  emoji?: string

  // Target configuration
  targets: TaskTarget[]

  // Scheduling
  schedule: TaskSchedule
  enabled: boolean

  // Execution config
  execution: TaskExecutionConfig

  // Metadata
  createdAt: string
  updatedAt: string
  lastRunAt?: string
  nextRunAt?: string
  totalRuns: number

  // Execution history (last 10)
  executions: TaskExecution[]
}

/**
 * Form types for creating/updating tasks
 */
export type CreateTaskForm = Omit<PeriodicTask, 'id' | 'createdAt' | 'updatedAt' | 'totalRuns' | 'executions'>

export type UpdateTaskForm = Partial<CreateTaskForm> & {
  id: string
}

export type TaskForm = CreateTaskForm | UpdateTaskForm

/**
 * Task list item for display
 */
export type TaskListItem = Pick<
  PeriodicTask,
  'id' | 'name' | 'emoji' | 'enabled' | 'schedule' | 'lastRunAt' | 'nextRunAt' | 'totalRuns'
> & {
  targetNames: string // Comma-separated target names
}

/**
 * Quick templates for common task types
 */
export interface TaskTemplate {
  id: string
  name: string
  description: string
  emoji?: string
  defaultSchedule: TaskSchedule
  defaultMessage: string
}
