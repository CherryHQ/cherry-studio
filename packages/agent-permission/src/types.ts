/** Shared, runtime-neutral permission vocabulary and evaluator contracts. */

import type { ToolGuardInteractionState, ToolGuardRule } from './toolGuards'

export const AGENT_PERMISSION_MODES = ['default', 'edit', 'auto', 'full'] as const
export type AgentPermissionMode = (typeof AGENT_PERMISSION_MODES)[number]

export type ToolCategory =
  | 'read'
  | 'edit'
  | 'shell'
  | 'meta'
  | 'safe-first-party'
  | 'sensitive-first-party'
  | 'requires-user'
  | 'non-bypassable'
  | 'ordinary'

export const HEADLESS_ASK_DENIAL =
  'This tool needs interactive approval, but this turn has no responder. Retry interactively or use a mode that does not require approval.'

export interface PermissionCall {
  /** Runtime-native name, retained for reasons and same-process guard rules. */
  toolName: string
  category: ToolCategory
  /** Structured paths extracted by the adapter. Relative paths resolve from the workspace root. */
  paths?: readonly string[]
  /** Shell text extracted by the adapter. */
  command?: string
  /** Edit tools may target a path that does not exist yet. */
  allowMissingTarget?: boolean
  /** Product-conduct facts normalized by the adapter. */
  conductTags?: readonly ('permanent-delete' | 'feedback-submission' | 'agent-config-mutation')[]
}

export interface PermissionLogEvent {
  message: string
  toolName?: string
  ruleId?: string
  error?: unknown
}

export interface PermissionContext {
  mode: AgentPermissionMode
  roots: { workspace: string; agentData: string }
  isDisabled: (toolName: string) => boolean
  responder: 'stream' | 'message' | 'unavailable'
  turn: 'interactive' | 'headless'
  delegated: boolean
  /** Full interaction facts for runtime-local predicates; `turn` is the evaluator's coarse view. */
  interaction?: ToolGuardInteractionState
  builtinRole?: string
  /** Runtime-local rules. Their functions never cross a subprocess boundary. */
  guardRules?: readonly ToolGuardRule[]
  /** Opaque same-process context forwarded to runtime-local guard conditions. */
  guardContext?: unknown
  log?: (event: PermissionLogEvent) => void
}

export type PermissionDecision =
  | { effect: 'allow' }
  | { effect: 'ask'; reason?: string; ruleId?: string; presentation: 'stream' | 'message' }
  | { effect: 'deny'; reason: string; ruleId: string }

export function normalizeLegacyPermissionMode(value: unknown): AgentPermissionMode {
  switch (value) {
    case 'edit':
    case 'acceptEdits':
      return 'edit'
    case 'auto':
      return 'auto'
    case 'full':
    case 'bypassPermissions':
      return 'full'
    case 'default':
    case 'plan':
    default:
      return 'default'
  }
}

export function foldDecisions(decisions: readonly PermissionDecision[]): PermissionDecision {
  if (decisions.length === 0) return { effect: 'allow' }
  return decisions
    .map((decision, index) => ({ decision, index }))
    .sort((a, b) => {
      const rank = (effect: PermissionDecision['effect']) => (effect === 'deny' ? 0 : effect === 'ask' ? 1 : 2)
      return rank(a.decision.effect) - rank(b.decision.effect) || a.index - b.index
    })[0].decision
}
