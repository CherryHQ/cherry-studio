import type { ClaudeControl, ClaudeResultFailure } from '@cherrystudio/agent-runtime-claude-code'

import type { AgentRuntimeEvent } from '../types'
import { convertClaudeCodeUsage, v3UsageToStats } from './usage'

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
      const usage = convertClaudeCodeUsage(control.usage)
      usage.outputTokens.reasoning = control.reasoningTokens
      return [{ type: 'chunk', chunk: { type: 'message-metadata', messageMetadata: { stats: v3UsageToStats(usage) } } }]
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
          ...(control.anchor && { anchor: { ...control.anchor, status: 'done', phase: 'agent-session' } })
        }
      ]
    case 'supported-commands':
      return [control]
    case 'background-tasks':
    case 'background-task-event':
    case 'background-work-state':
    case 'api-retry':
    case 'compaction-start':
    case 'compaction-error':
    case 'response-start':
      return [control]
    case 'input-boundary':
    case 'session':
    case 'context-usage':
    case 'diagnostic':
    case 'archive-changed':
      return []
  }
}
