/**
 * Periodic Task Manager Types
 * Manages scheduled tasks that can call agents/assistants
 */

/**
 * Task execution status
 */
export type TaskStatus = 'idle' | 'running' | 'completed' | 'failed' | 'paused' | 'terminated'

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
  /** Whether to use AI-powered smart planning for multiple targets */
  enableSmartPlanning?: boolean
  /** Whether to show plan confirmation before execution */
  confirmPlanBeforeExecution?: boolean
  /** Model ID to use for smart planning (e.g., 'anthropic:claude-3-5-sonnet-20241022'). Required when enableSmartPlanning is true. */
  planModel?: string
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
  /** Execution plan (for multi-target tasks) */
  plan?: TaskExecutionPlan
  /** Analysis of plan execution (for multi-target tasks with plans) */
  planAnalysis?: PlanExecutionAnalysis
  /** Session ID for continuing conversations */
  sessionId?: string
  /** Topic ID for continuing conversations */
  topicId?: string
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

// ==================== Smart Planning Types ====================

/**
 * Dependency relationship between task targets
 */
export interface TaskDependency {
  from: TaskTarget
  to: TaskTarget
  reason: string
  type: 'sequential' | 'parallel' | 'conditional'
}

/**
 * Metadata about the planning process
 */
export interface PlanningMetadata {
  /** Model used for planning (e.g., 'anthropic:claude-3-5-sonnet-20241022') */
  modelUsed: string
  /** Time taken to generate the plan (milliseconds) */
  planningTime: number
  /** Confidence score of the plan (0-1) */
  confidence: number
  /** Dependencies identified between targets */
  dependencies: TaskDependency[]
  /** Estimated total duration for all targets (seconds) */
  estimatedDuration: number
  /** Planning timestamp */
  plannedAt: string
  /** Reasoning behind the planning decisions */
  reasoning?: string
}

/**
 * Execution step for sequential execution
 */
export interface ExecutionStep {
  target: TaskTarget
  order: number
  reason: string
  estimatedDuration?: number
}

/**
 * Parallel execution group
 */
export interface ParallelExecutionGroup {
  targets: TaskTarget[]
  description: string
  estimatedDuration?: number
  reason: string
}

/**
 * Task execution plan with smart planning capabilities
 */
export interface TaskExecutionPlan {
  /** Sequential execution steps */
  steps: ExecutionStep[]
  /** Parallel execution groups (can run simultaneously) */
  parallelGroups: ParallelExecutionGroup[]
  /** Smart planning metadata (if AI planning was used) */
  planningMetadata?: PlanningMetadata
  /** Human-readable summary of the plan */
  summary?: string
}

/**
 * Result of planning process
 */
export interface PlanningResult {
  success: boolean
  plan?: TaskExecutionPlan
  error?: string
  duration: number
}

/**
 * Plan confirmation options
 */
export interface PlanConfirmationOptions {
  /** Show visualization of the plan */
  showVisualization: boolean
  /** Allow user to modify the plan */
  allowModification: boolean
  /** Auto-confirm if confidence is above threshold */
  autoConfirmThreshold?: number
}

/**
 * Execution result for a single target
 */
export interface TargetExecutionResult {
  target: TaskTarget
  success: boolean
  actualDuration: number
  estimatedDuration?: number
  output?: string
  error?: string
}

/**
 * Analysis of plan execution comparing planned vs actual
 */
export interface PlanExecutionAnalysis {
  /** Plan execution timestamp */
  analyzedAt: string

  /** Overall execution metrics */
  totalActualDuration: number
  totalEstimatedDuration?: number
  durationAccuracy: number // Percentage (0-1), how close actual was to estimated

  /** Success metrics */
  totalTargets: number
  successfulTargets: number
  failedTargets: number
  successRate: number // 0-1

  /** Per-target execution results */
  targetResults: TargetExecutionResult[]

  /** Performance insights */
  insights: {
    /** Was the execution within estimated time? */
    withinEstimatedTime: boolean
    /** Which targets exceeded their estimates */
    slowTargets: string[]
    /** Which targets were faster than estimated */
    fastTargets: string[]
    /** Which targets failed */
    failedTargetNames: string[]
    /** Suggestions for improving future plans */
    suggestions: string[]
  }

  /** Planning quality metrics */
  planningQuality?: {
    /** Was the plan's confidence justified? */
    confidenceJustified: boolean
    /** Did dependencies cause any issues? */
    dependenciesWorked: boolean
    /** Should use rule-based planning next time? */
    recommendRuleBased: boolean
  }
}
