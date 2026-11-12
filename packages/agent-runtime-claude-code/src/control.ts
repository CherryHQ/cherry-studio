import type {
  SDKMessage,
  SDKResultMessage,
  SDKAPIRetryMessage,
  SDKBackgroundTasksChangedMessage,
  SDKCompactBoundaryMessage,
  SDKSessionStateChangedMessage,
  SDKStatusMessage,
  SDKTaskNotificationMessage,
  SDKTaskProgressMessage,
  SDKTaskStartedMessage,
  SDKTaskUpdatedMessage,
  SDKToolProgressMessage
} from '@anthropic-ai/claude-agent-sdk'

import type { OperationResult } from '@cherrystudio/agent-runtime'

import { isSyntheticClaudeModel } from './synthetic'

export interface ClaudeTaskFact {
  message: SdkTaskSystemMessage
  status?: 'pending' | 'in_progress' | 'completed' | 'stopped' | 'error'
}

export interface ClaudeResultFailure {
  readonly message: string
  readonly subtype: SDKResultMessage['subtype']
  readonly errors: readonly string[]
  readonly terminalReason?: SDKResultMessage['terminal_reason']
  readonly statusCode?: number | null
}

type BackgroundTask = SDKBackgroundTasksChangedMessage['tasks'][number] & { toolCallId?: string }
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
  | { type: 'autonomous-turn-state'; state: 'started' | 'finished'; sourceToolCallIds?: readonly string[] }
  | { type: 'background-work-state'; active: boolean }
  | { type: 'background-results'; result: OperationResult<readonly string[]> }
  | { type: 'background-tasks'; tasks: BackgroundTask[] }
  | { type: 'background-task-event'; data: ClaudeTaskFact }
  | { type: 'archive-changed' }
  | { type: 'compaction-start' }
  | {
      type: 'compaction-complete'
      anchor?: SDKCompactBoundaryMessage['compact_metadata'] & { completedAt: string }
    }
  | { type: 'compaction-error'; error: string }
  | {
      type: 'api-retry'
      retry: SDKAPIRetryMessage | NonNullable<SDKToolProgressMessage['subagent_retry']>
      subagentType?: SDKToolProgressMessage['subagent_type']
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
  private readonly pendingResults = new Map<string, { toolCallId?: string; notified: boolean; answered: boolean }>()
  private readonly notificationRuns = new Set<string>()
  private reasoningTokens?: number
  private readonly taskTools = new Map<string, string>()
  private messageUuid?: string
  private compactBoundary?: { sessionId: string; messageUuid: string }
  private compactBoundaryCount = 0
  private compactRestorePoint?: string

  constructor(private readonly emit: (event: ClaudeControl) => void) {}

  get snapshot() {
    return {
      active: this.isTurnActive,
      aborted: this.sawAbortedMessage,
      backgroundTasks: this.backgroundTasks.map((task) => {
        const toolCallId = this.backgroundTaskToolCallIds.get(task.run_id ?? task.task_id)
        return toolCallId ? { ...task, toolCallId } : task
      }),
      backgroundWorkActive: this.backgroundTasks.length > 0 || this.backgroundWorkReleasePending,
      backgroundResults: this.resultSources()
    }
  }

  beginTurn(): void {
    this.isTurnActive = true
    this.sawAbortedMessage = false
    this.autonomousTurn = false
    this.reasoningTokens = undefined
    this.messageUuid = undefined
    this.compactBoundary = undefined
    this.compactBoundaryCount = 0
    this.compactRestorePoint = undefined
    this.notificationRuns.clear()
  }

  get pendingCompactBoundary() {
    return this.isTurnActive && this.compactBoundaryCount === 1 ? this.compactBoundary : undefined
  }

  setCompactRestorePoint(point: { sessionId: string; messageUuid: string }): void {
    if (this.pendingCompactBoundary?.sessionId === point.sessionId) this.compactRestorePoint = point.messageUuid
  }

  accept(message: SDKMessage): void {
    if (message.type === 'assistant' && isSyntheticClaudeModel(message.message.model)) {
      this.sawAbortedMessage ||= message.aborted === true
      return
    }
    if (
      message.type === 'stream_event' &&
      message.event.type === 'message_start' &&
      isSyntheticClaudeModel(message.event.message.model)
    )
      return
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
        messageUuid: !resultFailure(message) ? (this.compactRestorePoint ?? this.messageUuid) : this.messageUuid,
        terminal: this.isTurnActive,
        usage: message.usage,
        reasoningTokens: this.reasoningTokens,
        failure: resultFailure(message)
      })
      if (!this.isTurnActive) return
      this.isTurnActive = false
      for (const id of this.notificationRuns) {
        const pending = this.pendingResults.get(id)
        if (pending) pending.answered = true
      }
      if (this.autonomousTurn) {
        this.autonomousTurn = false
        this.emit({ type: 'autonomous-turn-state', state: 'finished' })
      }
      return
    }
    if (
      !this.isTurnActive &&
      (message.type === 'assistant' || message.type === 'stream_event' || message.type === 'user')
    ) {
      this.beginTurn()
      this.autonomousTurn = true
      const run =
        message.type === 'user' && message.origin?.kind === 'task-notification' ? message.origin.runId : undefined
      for (const [id, pending] of this.pendingResults)
        if (run ? run === id : pending.notified && !pending.answered) this.notificationRuns.add(id)
      const sources = [...this.notificationRuns].flatMap((id) => this.pendingResults.get(id)?.toolCallId ?? [])
      this.emit({
        type: 'autonomous-turn-state',
        state: 'started',
        ...(sources.length && { sourceToolCallIds: sources })
      })
    }
    if (message.type === 'user' && message.origin?.kind === 'task-notification' && message.origin.runId)
      this.notificationRuns.add(message.origin.runId)
    if (message.type === 'system' && message.subtype === 'init')
      this.emit({ type: 'session', sessionId: message.session_id })
    if (message.type === 'stream_event' && message.event.type === 'message_start')
      this.emit({ type: 'response-start', responseId: message.event.message.id })
    if (message.type === 'assistant') {
      this.messageUuid = message.uuid
      this.emit({ type: 'response-start', responseId: message.message.id, messageUuid: message.uuid })
      this.sawAbortedMessage ||= message.aborted === true
      for (const block of message.message.content)
        if (block.type === 'tool_use' && ['Task', 'Agent', 'Workflow', 'Bash'].includes(block.name))
          this.taskTools.set(block.id, block.name)
    }
    if (message.type === 'user' && Array.isArray(message.message.content)) {
      for (const block of message.message.content) {
        if (block.type !== 'tool_result' || block.is_error) continue
        const name = this.taskTools.get(block.tool_use_id)
        if (!name || name === 'Bash') continue
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
        this.backgroundTasks = message.tasks
        for (const task of message.tasks) {
          if (!['subagent', 'local_agent', 'local_workflow'].includes(task.task_type) || task.ambient) continue
          const id = task.run_id ?? task.task_id
          if (!this.pendingResults.has(id))
            this.pendingResults.set(id, {
              toolCallId: this.backgroundTaskToolCallIds.get(id),
              notified: false,
              answered: false
            })
        }
        this.publishBackgroundTasks()
        this.emit({ type: 'background-results', result: this.resultSources() })
        this.backgroundWorkReleasePending = message.tasks.length === 0
        if (message.tasks.length) this.emit({ type: 'background-work-state', active: true })
    }
    return undefined
  }
  private publishBackgroundTasks(): void {
    this.emit({
      type: 'background-tasks',
      tasks: this.snapshot.backgroundTasks
    })
  }

  private resultSources(): OperationResult<readonly string[]> {
    const pending = [...this.pendingResults.values()]
    if (pending.some((result) => !result.toolCallId))
      return {
        status: 'unknown',
        error: {
          operation: 'backgroundResults',
          code: 'missing-result-origin',
          message: 'A Claude background result has no native triggering call'
        }
      }
    return {
      status: 'confirmed',
      value: [...new Set(pending.flatMap((result) => (result.toolCallId ? [result.toolCallId] : [])))]
    }
  }

  private registerBackgroundTaskToolCallId(taskId: string, toolCallId: string, runId?: string): void {
    const task = this.backgroundTasks.find((task) => task.task_id === taskId)
    const id = runId ?? task?.run_id ?? taskId
    if (this.backgroundTaskToolCallIds.get(id) === toolCallId) return
    this.backgroundTaskToolCallIds.set(id, toolCallId)
    const pending = this.pendingResults.get(id)
    if (pending) {
      pending.toolCallId = toolCallId
      this.emit({ type: 'background-results', result: this.resultSources() })
    }
    if (task) this.publishBackgroundTasks()
  }

  private handleTaskSystemMessage(message: SdkTaskSystemMessage): void {
    const toolUseId = 'tool_use_id' in message ? message.tool_use_id : undefined
    if (
      toolUseId &&
      (this.taskTools.has(toolUseId) ||
        (message.subtype === 'task_started' &&
          ['subagent', 'local_agent', 'local_workflow'].includes(message.task_type ?? '')) ||
        ('subagent_type' in message && message.subagent_type))
    ) {
      this.registerBackgroundTaskToolCallId(message.task_id, toolUseId, message.run_id)
    }

    if (message.subtype === 'task_notification') {
      const id = message.run_id ?? message.task_id
      let pending = this.pendingResults.get(id)
      const toolCallId = this.backgroundTaskToolCallIds.get(id)
      if (
        !pending &&
        toolCallId &&
        this.taskTools.get(toolCallId) === 'Bash' &&
        !message.ambient &&
        !message.skip_transcript
      ) {
        pending = { toolCallId, notified: true, answered: false }
        this.pendingResults.set(id, pending)
        this.emit({ type: 'background-results', result: this.resultSources() })
      }
      if (pending) pending.notified = true
    }
    const status =
      message.subtype === 'task_updated'
        ? mapTaskStatus(message.patch.status)
        : message.subtype === 'task_notification'
          ? mapTaskStatus(message.status)
          : 'in_progress'
    this.emit({ type: 'background-task-event', data: { message, status } })
  }

  private handleApiRetrySystemMessage(message: SDKAPIRetryMessage): void {
    if (!this.isTurnActive) return
    this.emit({ type: 'api-retry', retry: message })
  }

  private handleToolProgressMessage(message: SDKToolProgressMessage): void {
    const retry = message.subagent_retry
    if (!retry || !this.isTurnActive) return
    this.emit({
      type: 'api-retry',
      retry,
      ...(message.subagent_type ? { subagentType: message.subagent_type } : {})
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
    for (const [id, pending] of this.pendingResults)
      if (pending.notified && !this.backgroundTasks.some((task) => (task.run_id ?? task.task_id) === id))
        this.pendingResults.delete(id)
    this.emit({ type: 'background-results', result: this.resultSources() })
    if (!this.backgroundWorkReleasePending || this.pendingResults.size > 0) return
    this.backgroundWorkReleasePending = false
    this.emit({ type: 'background-work-state', active: false })
  }

  private handleCompactBoundarySystemMessage(message: SDKCompactBoundaryMessage): void {
    if (this.isTurnActive) {
      this.compactBoundaryCount++
      if (message.compact_metadata.trigger === 'manual')
        this.compactBoundary = { sessionId: message.session_id, messageUuid: message.uuid }
    }
    this.emit({
      type: 'compaction-complete',
      anchor: { ...message.compact_metadata, completedAt: new Date().toISOString() }
    })
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
