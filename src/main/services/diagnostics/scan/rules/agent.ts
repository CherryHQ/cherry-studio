import { JOB_ERROR_CODES } from '@shared/data/api/schemas/jobs'

import type { ScanRule } from '../types'

// SSOT: AGENT_SESSION_DELIVERY_ERROR_CODES in @main/data/services/AgentSessionMessageService —
// importing it would drag the whole data layer into this module graph, so the literal is repeated here.
const SESSION_TOOL_FORBIDDEN = 'SESSION_TOOL_FORBIDDEN'

/** Agent runtime failures: silent runtimes, CLI adapters, tool loops, session policies. */
export const agentRules: readonly ScanRule[] = [
  {
    id: 'agent-runtime-no-response',
    domain: 'agent',
    attribution: 'transient',
    devMessage:
      'The agent runtime gave up without a model response (AgentRuntimeError "No response"); typically an upstream hiccup that clears on retry.',
    anchors: [/AgentRuntimeError[\s\S]{0,120}No response|No response (?:received|from (?:model|provider))/i]
  },
  {
    id: 'agent-claude-code-failed',
    domain: 'agent',
    attribution: 'app-bug',
    devMessage:
      'The embedded Claude Code runtime reported a terminal failure (ClaudeCodeResultError); inspect the wrapped result for the upstream cause.',
    anchors: [/ClaudeCodeResultError/]
  },
  {
    id: 'agent-tool-loop-terminated',
    domain: 'agent',
    attribution: 'app-bug',
    devMessage:
      'The tool-call loop aborted (ToolLoopTerminalError / missing tool output); a tool result was lost or the loop guard fired too early.',
    anchors: [/ToolLoopTerminalError|No tool output found/i]
  },
  {
    id: 'agent-policy-rejected',
    domain: 'agent',
    attribution: 'user-fixable',
    devMessage:
      'An agent operation was rejected by session or scheduling policy (session tools forbidden in this turn, or a schedule name conflict).',
    anchors: [new RegExp(`${SESSION_TOOL_FORBIDDEN}|${JOB_ERROR_CODES.SCHEDULE_NAME_CONFLICT}`)]
  }
]
