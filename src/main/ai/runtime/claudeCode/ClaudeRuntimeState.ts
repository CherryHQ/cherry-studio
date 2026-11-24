import type { ClaudeControl, ClaudeResultFailure, ClaudeTaskFact } from '@cherrystudio/agent-runtime-claude-code'
import type { MessageStats } from '@shared/data/types/message'
import type { AgentTaskEventPartData } from '@shared/data/types/uiParts'

import type { AgentRuntimeEvent } from '../types'

export class ClaudeCodeResultError extends Error {
  readonly exitCode = 1
  readonly subtype: ClaudeResultFailure['subtype']
  readonly errors: readonly string[]
  readonly terminalReason: ClaudeResultFailure['terminalReason']
  readonly statusCode: ClaudeResultFailure['statusCode']

  constructor(failure: ClaudeResultFailure) {
    super(failure.message)
    this.name = 'ClaudeCodeResultError'
    this.subtype = failure.subtype
    this.errors = failure.errors
    this.terminalReason = failure.terminalReason
    this.statusCode = failure.statusCode
  }
}

export function claudeControlEvents(control: ClaudeControl): AgentRuntimeEvent[] {
  switch (control.type) {
    case 'result': {
      const noCacheTokens = control.usage.input_tokens ?? 0
      const cacheReadTokens = control.usage.cache_read_input_tokens ?? 0
      const cacheWriteTokens = control.usage.cache_creation_input_tokens ?? 0
      // Native input_tokens excludes cache buckets; display statistics count all input tokens.
      const inputTokens = noCacheTokens + cacheWriteTokens + cacheReadTokens
      const outputTokens = control.usage.output_tokens ?? 0
      const stats: MessageStats = {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        inputTokenDetails: { noCacheTokens, cacheReadTokens, cacheWriteTokens }
      }

      if (control.reasoningTokens !== undefined) {
        stats.outputTokenDetails = { reasoningTokens: control.reasoningTokens }
      }

      return [{ type: 'chunk', chunk: { type: 'message-metadata', messageMetadata: { stats } } }]
    }

    case 'autonomous-turn-state':
      return [
        control.state === 'started'
          ? { ...control, origin: { kind: 'background-work' } }
          : { type: 'autonomous-turn-state', state: 'finished' }
      ]
    case 'compaction-complete':
      return [
        {
          type: 'compaction-complete',
          ...(control.anchor && {
            anchor: {
              status: 'done',
              phase: 'agent-session',
              trigger: control.anchor.trigger,
              completedAt: control.anchor.completedAt,
              preTokens: control.anchor.pre_tokens,
              postTokens: control.anchor.post_tokens,
              durationMs: control.anchor.duration_ms
            }
          })
        }
      ]
    case 'background-tasks':
      return [
        {
          type: 'background-tasks',
          tasks: control.tasks.map((task) => ({
            id: task.task_id,
            type: task.task_type,
            description: task.description,
            ...(task.toolCallId && { toolCallId: task.toolCallId })
          }))
        }
      ]
    case 'background-task-event':
      return [{ type: 'background-task-event', data: taskEventData(control.data) }]
    case 'api-retry':
      return [
        {
          type: 'api-retry',
          retry: {
            attempt: control.retry.attempt,
            maxRetries: control.retry.max_retries,
            retryDelayMs: control.retry.retry_delay_ms,
            errorStatus: control.retry.error_status,
            errorCategory: 'error' in control.retry ? control.retry.error : control.retry.error_category,
            ...(control.subagentType && { subagentType: control.subagentType })
          }
        }
      ]
    case 'supported-commands':
    case 'background-work-state':
    case 'background-results':
    case 'compaction-start':
    case 'compaction-error':
    case 'response-start':
      return [control]
    case 'input-boundary':
    case 'session':
    case 'diagnostic':
    case 'archive-changed':
      return []
  }
}

function taskEventData({ message, status }: ClaudeTaskFact): AgentTaskEventPartData {
  const base = {
    taskId: message.task_id,
    toolUseId: 'tool_use_id' in message ? message.tool_use_id : undefined,
    status
  }

  switch (message.subtype) {
    case 'task_started':
      return {
        ...base,
        event: 'started',
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
        title: message.summary ?? message.description,
        activeText: message.description,
        description: message.description,
        summary: message.summary,
        subagentType: message.subagent_type,
        lastToolName: message.last_tool_name,
        usage: taskUsage(message.usage)
      }
    case 'task_updated':
      return {
        ...base,
        event: 'updated',
        title: message.patch.description,
        activeText: status === 'in_progress' ? message.patch.description : undefined,
        description: message.patch.description,
        error: message.patch.error,
        isBackgrounded: message.patch.is_backgrounded
      }
    case 'task_notification':
      return {
        ...base,
        event: 'notification',
        summary: message.summary,
        outputFile: message.output_file,
        skipTranscript: message.skip_transcript === true,
        usage: taskUsage(message.usage)
      }
  }
}

function taskUsage(
  value: Extract<ClaudeTaskFact['message'], { subtype: 'task_progress' | 'task_notification' }>['usage']
): AgentTaskEventPartData['usage'] {
  if (!value) return undefined

  return { totalTokens: value.total_tokens, toolUses: value.tool_uses, durationMs: value.duration_ms }
}
