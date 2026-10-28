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

import { loggerService } from '@logger'
import type { AgentSessionBackgroundTask } from '@shared/ai/agentSessionBackgroundTasks'
import type { AgentSessionCompactionAnchorData } from '@shared/ai/agentSessionCompaction'
import type { AgentTaskEventPartData } from '@shared/data/types/uiParts'

import type { AgentRuntimeEvent } from '../types'
import { normalizeClaudeToolResult } from './ClaudeMessageMetadata'
import { convertClaudeCodeUsage, v3UsageToStats } from './usage'

const logger = loggerService.withContext('ClaudeRuntimeState')
type SdkTaskSystemMessage =
  | SDKTaskNotificationMessage
  | SDKTaskProgressMessage
  | SDKTaskStartedMessage
  | SDKTaskUpdatedMessage
type SdkTaskStatus = SDKTaskNotificationMessage['status'] | SDKTaskUpdatedMessage['patch']['status'] | undefined
export class ClaudeCodeResultError extends Error {
  readonly exitCode = 1
  constructor(
    message: string,
    readonly subtype: SDKResultMessage['subtype'],
    /** The result's diagnostic strings — match against these, not the joined `message`. */
    readonly errors: readonly string[],
    readonly terminalReason?: SDKResultMessage['terminal_reason'],
    readonly statusCode?: number | null
  ) {
    super(message)
    this.name = 'ClaudeCodeResultError'
  }
}

function createClaudeCodeResultError(message: SDKResultMessage): ClaudeCodeResultError | undefined {
  const apiErrorStatus = message.subtype === 'success' ? message.api_error_status : undefined
  const isErrorResult =
    message.subtype !== 'success' ||
    message.is_error ||
    message.terminal_reason === 'api_error' ||
    apiErrorStatus != null
  if (!isErrorResult) return undefined

  const errors = message.subtype === 'success' ? (message.result ? [message.result] : []) : message.errors
  const errorMessage = errors.join('; ') || `Claude Code error: ${message.terminal_reason ?? message.subtype}`
  return new ClaudeCodeResultError(errorMessage, message.subtype, errors, message.terminal_reason, apiErrorStatus)
}

function mapTaskStatus(status: SdkTaskStatus): AgentTaskEventPartData['status'] | undefined {
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

export class ClaudeRuntimeState {
  isTurnActive = false
  sawAbortedMessage = false
  private autonomousTurn = false
  private backgroundWorkReleasePending = false
  private backgroundTasks: AgentSessionBackgroundTask[] = []
  private readonly backgroundTaskToolCallIds = new Map<string, string>()
  private reasoningTokens?: number
  private readonly taskTools = new Map<string, string>()

  constructor(private readonly emit: (event: AgentRuntimeEvent) => void) {}

  beginTurn(): void {
    this.isTurnActive = true
    this.sawAbortedMessage = false
    this.autonomousTurn = false
    this.reasoningTokens = undefined
  }

  accept(message: SDKMessage): SDKResultMessage | undefined {
    if ('parent_tool_use_id' in message && message.parent_tool_use_id != null) return
    if (message.type === 'result') {
      if (message.origin?.kind === 'task-notification' && !this.autonomousTurn) return
      const usage = convertClaudeCodeUsage(message.usage)
      usage.outputTokens.reasoning = this.reasoningTokens
      this.emit({
        type: 'chunk',
        chunk: { type: 'message-metadata', messageMetadata: { stats: v3UsageToStats(usage) } }
      })
      const error = createClaudeCodeResultError(message)
      if (error) throw error
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
      this.emit({ type: 'autonomous-turn-state', state: 'started', origin: { kind: 'background-work' } })
    }
    if (message.type === 'assistant') {
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
        const receipt = normalizeClaudeToolResult(block.content)
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
        if (failed.length) logger.warn('MCP servers not connected', { servers: failed })
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
      tasks: this.backgroundTasks.map((task) => {
        const toolCallId = this.backgroundTaskToolCallIds.get(task.id)
        return toolCallId ? { ...task, toolCallId } : task
      })
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
      logger.warn('Claude compaction failed', { sessionId: message.session_id, error: message.compact_error })
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
    const anchor: AgentSessionCompactionAnchorData = {
      status: 'done',
      phase: 'agent-session',
      trigger: metadata.trigger,
      completedAt: new Date().toISOString(),
      preTokens: metadata.pre_tokens
    }
    if (metadata.post_tokens !== undefined) anchor.postTokens = metadata.post_tokens
    if (metadata.duration_ms !== undefined) anchor.durationMs = metadata.duration_ms

    this.emit({ type: 'compaction-complete', anchor })
  }

  private toTaskEventPartData(message: SdkTaskSystemMessage): AgentTaskEventPartData {
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
  ): AgentTaskEventPartData['usage'] | undefined {
    if (!value) return undefined
    return {
      totalTokens: value.total_tokens,
      toolUses: value.tool_uses,
      durationMs: value.duration_ms
    }
  }
}
