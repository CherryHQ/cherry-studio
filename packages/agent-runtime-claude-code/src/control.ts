import type {
  SDKMessage,
  SDKResultMessage,
  SDKAPIRetryMessage,
  SDKCompactBoundaryMessage,
  SDKSessionStateChangedMessage,
  SDKStatusMessage,
  SDKTaskNotificationMessage,
  SDKTaskProgressMessage,
  SDKTaskStartedMessage,
  SDKTaskUpdatedMessage,
  SDKToolProgressMessage
} from '@anthropic-ai/claude-agent-sdk'

export interface ClaudeTaskFact {
  event: 'started' | 'progress' | 'updated' | 'notification'
  taskId: string
  toolUseId?: string
  status?: 'pending' | 'in_progress' | 'completed' | 'stopped' | 'error'
  title?: string
  activeText?: string
  description?: string
  summary?: string
  subagentType?: string
  taskType?: string
  workflowName?: string
  prompt?: string
  lastToolName?: string
  outputFile?: string
  error?: string
  /** Native per-task background state. */
  isBackgrounded?: boolean
  skipTranscript?: boolean
  usage?: {
    totalTokens?: number
    toolUses?: number
    durationMs?: number
  }
}

export interface ClaudeResultFailure {
  readonly message: string
  readonly subtype: SDKResultMessage['subtype']
  readonly errors: readonly string[]
  readonly terminalReason?: SDKResultMessage['terminal_reason']
  readonly statusCode?: number | null
}

type BackgroundTask = { id: string; type: string; description: string; toolCallId?: string }
type Compaction = {
  trigger: 'auto' | 'manual'
  completedAt: string
  preTokens: number
  postTokens?: number
  durationMs?: number
}
export type ClaudeControl =
  | { type: 'session'; sessionId: string }
  | { type: 'response-start'; responseId: string; messageUuid?: string }
  | { type: 'input-boundary'; inputIds: readonly string[] }
  | {
      type: 'result'
      sessionId: string
      messageUuid?: string
      terminal: boolean
      usage: SDKResultMessage['usage']
      reasoningTokens?: number
      failure?: ClaudeResultFailure
    }
  | {
      type: 'context-usage'
      usage: {
        input_tokens?: number | null
        cache_creation_input_tokens?: number | null
        cache_read_input_tokens?: number | null
      }
    }
  | { type: 'autonomous-turn-state'; state: 'started' | 'finished' }
  | { type: 'background-work-state'; active: boolean; awaitingReply?: boolean }
  | { type: 'background-tasks'; tasks: BackgroundTask[] }
  | { type: 'background-task-event'; data: ClaudeTaskFact }
  | { type: 'archive-changed' }
  | { type: 'compaction-start' }
  | { type: 'compaction-complete'; anchor?: Compaction }
  | { type: 'compaction-error'; error: string }
  | {
      type: 'api-retry'
      retry: {
        attempt: number
        maxRetries: number
        retryDelayMs: number
        errorStatus: number | null
        errorCategory: string
        subagentType?: string
      }
    }
  | {
      type: 'supported-commands'
      commands: Extract<SDKMessage, { type: 'system'; subtype: 'commands_changed' }>['commands']
    }
  | { type: 'diagnostic'; message: string; detail?: unknown }

type SdkTaskSystemMessage =
  | SDKTaskNotificationMessage
  | SDKTaskProgressMessage
  | SDKTaskStartedMessage
  | SDKTaskUpdatedMessage
type SdkTaskStatus = SDKTaskNotificationMessage['status'] | SDKTaskUpdatedMessage['patch']['status'] | undefined
function resultFailure(message: SDKResultMessage): ClaudeResultFailure | undefined {
  const apiErrorStatus = message.subtype === 'success' ? message.api_error_status : undefined
  const isErrorResult =
    message.subtype !== 'success' ||
    message.is_error ||
    message.terminal_reason === 'api_error' ||
    apiErrorStatus != null
  if (!isErrorResult) return undefined

  const errors = message.subtype === 'success' ? (message.result ? [message.result] : []) : message.errors
  const errorMessage = errors.join('; ') || `Claude Code error: ${message.terminal_reason ?? message.subtype}`
  return {
    message: errorMessage,
    subtype: message.subtype,
    errors,
    terminalReason: message.terminal_reason,
    statusCode: apiErrorStatus
  }
}

function mapTaskStatus(status: SdkTaskStatus): ClaudeTaskFact['status'] | undefined {
  switch (status) {
    case 'pending':
      return 'pending'
    case 'running':
    case 'paused':
      return 'in_progress'
    case 'completed':
      return 'completed'
    case 'stopped':
      return 'stopped'
    case 'failed':
    case 'killed':
      return 'error'
    default:
      return undefined
  }
}

export class ClaudeControlState {
  isTurnActive = false
  sawAbortedMessage = false
  private autonomousTurn = false
  private backgroundWorkReleasePending = false
  private backgroundTasks: BackgroundTask[] = []
  private readonly backgroundTaskToolCallIds = new Map<string, string>()
  private reasoningTokens?: number
  private readonly taskTools = new Map<string, string>()
  private messageUuid?: string

  constructor(private readonly emit: (event: ClaudeControl) => void) {}

  get snapshot() {
    return {
      active: this.isTurnActive,
      aborted: this.sawAbortedMessage,
      backgroundTasks: this.backgroundTasks.map((task) => {
        const toolCallId = this.backgroundTaskToolCallIds.get(task.id)
        return toolCallId ? { ...task, toolCallId } : task
      }),
      backgroundWorkActive: this.backgroundTasks.length > 0 || this.backgroundWorkReleasePending
    }
  }

  beginTurn(): void {
    this.isTurnActive = true
    this.sawAbortedMessage = false
    this.autonomousTurn = false
    this.reasoningTokens = undefined
    this.messageUuid = undefined
  }

  accept(message: SDKMessage): SDKResultMessage | undefined {
    if ('parent_tool_use_id' in message && message.parent_tool_use_id != null) {
      if (message.type === 'assistant')
        this.emit({ type: 'response-start', responseId: message.message.id, messageUuid: message.uuid })
      return
    }
    if (message.type === 'result') {
      if (message.origin?.kind === 'task-notification' && !this.autonomousTurn) return
      this.emit({ type: 'session', sessionId: message.session_id })
      this.emit({
        type: 'result',
        sessionId: message.session_id,
        messageUuid: this.messageUuid,
        terminal: this.isTurnActive,
        usage: message.usage,
        reasoningTokens: this.reasoningTokens,
        failure: resultFailure(message)
      })
      if (!this.isTurnActive) return
      this.isTurnActive = false
      if (this.autonomousTurn) {
        this.autonomousTurn = false
        this.emit({ type: 'autonomous-turn-state', state: 'finished' })
      }
      return message
    }
    if (
      !this.isTurnActive &&
      (message.type === 'assistant' || message.type === 'stream_event' || message.type === 'user')
    ) {
      this.beginTurn()
      this.autonomousTurn = true
      this.emit({ type: 'autonomous-turn-state', state: 'started' })
    }
    if (message.type === 'system' && message.subtype === 'init')
      this.emit({ type: 'session', sessionId: message.session_id })
    if (message.type === 'stream_event') {
      if (message.event.type === 'message_start') {
        this.emit({ type: 'response-start', responseId: message.event.message.id })
        this.emit({ type: 'context-usage', usage: message.event.message.usage })
      } else if (message.event.type === 'message_delta' && message.event.usage?.input_tokens != null)
        this.emit({ type: 'context-usage', usage: message.event.usage })
    }
    if (message.type === 'assistant') {
      this.messageUuid = message.uuid
      this.emit({ type: 'response-start', responseId: message.message.id, messageUuid: message.uuid })
      this.sawAbortedMessage ||= message.aborted === true
      for (const block of message.message.content)
        if (block.type === 'tool_use' && ['Task', 'Agent', 'Workflow'].includes(block.name))
          this.taskTools.set(block.id, block.name)
    }
    if (message.type === 'user' && Array.isArray(message.message.content)) {
      for (const block of message.message.content) {
        if (block.type !== 'tool_result' || block.is_error) continue
        const name = this.taskTools.get(block.tool_use_id)
        if (!name) continue
        const receipt = taskReceipt(block.content)
        if (typeof receipt !== 'object' || receipt === null || Array.isArray(receipt)) continue
        if (name === 'Workflow' && receipt.taskType !== 'local_workflow') continue
        const id = receipt.taskId ?? receipt.agentId
        if ((receipt.status === 'async_launched' || receipt.status === 'remote_launched') && typeof id === 'string')
          this.registerBackgroundTaskToolCallId(id, block.tool_use_id)
      }
    }
    if (message.type === 'tool_progress') this.handleToolProgressMessage(message)
    if (message.type !== 'system') return
    switch (message.subtype) {
      case 'init': {
        const failed = message.mcp_servers.filter(
          (server) => server.status === 'failed' || server.status === 'needs-auth'
        )
        if (failed.length) this.emit({ type: 'diagnostic', message: 'MCP servers not connected', detail: failed })
        return
      }
      case 'task_started':
      case 'task_progress':
      case 'task_updated':
      case 'task_notification':
        this.handleTaskSystemMessage(message)
        return
      case 'status':
        this.handleStatusSystemMessage(message)
        return
      case 'compact_boundary':
        this.handleCompactBoundarySystemMessage(message)
        this.emit({ type: 'archive-changed' })
        return
      case 'session_state_changed':
        this.handleSessionStateChangedSystemMessage(message)
        return
      case 'api_retry':
        this.handleApiRetrySystemMessage(message)
        return
      case 'thinking_tokens':
        this.reasoningTokens = message.estimated_tokens
        return
      case 'commands_changed':
        this.emit({ type: 'supported-commands', commands: message.commands })
        return
      case 'background_tasks_changed':
        this.backgroundTasks = message.tasks.map((task) => ({
          id: task.task_id,
          type: task.task_type,
          description: task.description
        }))
        this.publishBackgroundTasks()
        this.backgroundWorkReleasePending = message.tasks.length === 0
        if (message.tasks.length) this.emit({ type: 'background-work-state', active: true, awaitingReply: false })
    }
    return undefined
  }
  private publishBackgroundTasks(): void {
    this.emit({
      type: 'background-tasks',
      tasks: this.snapshot.backgroundTasks
    })
  }

  private registerBackgroundTaskToolCallId(taskId: string, toolCallId: string): void {
    if (this.backgroundTaskToolCallIds.get(taskId) === toolCallId) return
    this.backgroundTaskToolCallIds.set(taskId, toolCallId)
    if (this.backgroundTasks.some((task) => task.id === taskId)) this.publishBackgroundTasks()
  }

  private handleTaskSystemMessage(message: SdkTaskSystemMessage): void {
    const eventData = this.toTaskEventPartData(message)

    if (
      eventData.toolUseId &&
      (eventData.taskType === 'subagent' ||
        eventData.taskType === 'local_agent' ||
        eventData.taskType === 'local_workflow' ||
        eventData.subagentType)
    ) {
      this.registerBackgroundTaskToolCallId(eventData.taskId, eventData.toolUseId)
    }

    this.emit({ type: 'background-task-event', data: eventData })
  }

  private handleApiRetrySystemMessage(message: SDKAPIRetryMessage): void {
    if (!this.isTurnActive) return
    this.emit({
      type: 'api-retry',
      retry: {
        attempt: message.attempt,
        maxRetries: message.max_retries,
        retryDelayMs: message.retry_delay_ms,
        errorStatus: message.error_status,
        errorCategory: message.error
      }
    })
  }

  private handleToolProgressMessage(message: SDKToolProgressMessage): void {
    const retry = message.subagent_retry
    if (!retry || !this.isTurnActive) return
    this.emit({
      type: 'api-retry',
      retry: {
        attempt: retry.attempt,
        maxRetries: retry.max_retries,
        retryDelayMs: retry.retry_delay_ms,
        errorStatus: retry.error_status,
        errorCategory: retry.error_category,
        ...(message.subagent_type ? { subagentType: message.subagent_type } : {})
      }
    })
  }

  private handleStatusSystemMessage(message: SDKStatusMessage): void {
    if (message.status === 'compacting') {
      this.emit({ type: 'compaction-start' })
      return
    }
    if (message.compact_result === 'failed' || message.compact_error) {
      this.emit({ type: 'compaction-error', error: message.compact_error ?? 'Compaction failed' })
      return
    }
    if (message.compact_result === 'success') {
      this.emit({ type: 'compaction-complete' })
    }
  }

  private handleSessionStateChangedSystemMessage(message: SDKSessionStateChangedMessage): void {
    if (message.state !== 'idle') return
    if (!this.backgroundWorkReleasePending) return
    this.backgroundWorkReleasePending = false
    this.emit({ type: 'background-work-state', active: false })
  }

  private handleCompactBoundarySystemMessage(message: SDKCompactBoundaryMessage): void {
    const metadata = message.compact_metadata
    const anchor: Compaction = {
      trigger: metadata.trigger,
      completedAt: new Date().toISOString(),
      preTokens: metadata.pre_tokens
    }
    if (metadata.post_tokens !== undefined) anchor.postTokens = metadata.post_tokens
    if (metadata.duration_ms !== undefined) anchor.durationMs = metadata.duration_ms

    this.emit({ type: 'compaction-complete', anchor })
  }

  private toTaskEventPartData(message: SdkTaskSystemMessage): ClaudeTaskFact {
    const base = {
      taskId: message.task_id,
      toolUseId: 'tool_use_id' in message ? message.tool_use_id : undefined
    }

    switch (message.subtype) {
      case 'task_started':
        return {
          ...base,
          event: 'started',
          status: 'in_progress',
          title: message.description,
          activeText: message.description,
          description: message.description,
          subagentType: message.subagent_type,
          taskType: message.task_type,
          workflowName: message.workflow_name,
          prompt: message.prompt,
          skipTranscript: message.skip_transcript === true
        }
      case 'task_progress':
        return {
          ...base,
          event: 'progress',
          status: 'in_progress',
          title: message.summary ?? message.description,
          activeText: message.description,
          description: message.description,
          summary: message.summary,
          subagentType: message.subagent_type,
          lastToolName: message.last_tool_name,
          usage: this.getTaskUsage(message.usage)
        }
      case 'task_updated': {
        const status = mapTaskStatus(message.patch.status)
        return {
          ...base,
          event: 'updated',
          status,
          title: message.patch.description,
          activeText: status === 'in_progress' ? message.patch.description : undefined,
          description: message.patch.description,
          error: message.patch.error,
          isBackgrounded: message.patch.is_backgrounded
        }
      }
      case 'task_notification':
        return {
          ...base,
          event: 'notification',
          status: mapTaskStatus(message.status),
          summary: message.summary,
          outputFile: message.output_file,
          skipTranscript: message.skip_transcript === true,
          usage: this.getTaskUsage(message.usage)
        }
    }
  }

  private getTaskUsage(
    value: SDKTaskNotificationMessage['usage'] | SDKTaskProgressMessage['usage'] | undefined
  ): ClaudeTaskFact['usage'] | undefined {
    if (!value) return undefined
    return {
      totalTokens: value.total_tokens,
      toolUses: value.tool_uses,
      durationMs: value.duration_ms
    }
  }
}

function taskReceipt(content: unknown): Record<string, unknown> | undefined {
  const text =
    typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content.map((block) => (block?.type === 'text' ? block.text : '')).join('\n')
        : undefined
  if (!text) return undefined
  try {
    const value = JSON.parse(text)
    return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined
  } catch {
    return undefined
  }
}
