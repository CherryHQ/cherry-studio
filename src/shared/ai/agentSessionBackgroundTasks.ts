import type { AgentTaskEventPartData } from '../data/types/uiParts'

/**
 * Runtime-neutral background work that outlives the turn which spawned it. Drivers normalize their
 * native task payloads into this app-owned shape before crossing the runtime boundary.
 */
export type AgentSessionBackgroundTask = {
  id: string
  type: string
  description: string
  /** Driver-provided root tool call when its native protocol explicitly correlates a launch receipt. */
  toolCallId?: string
}

/**
 * REPLACE semantics: drivers publish the full set on every membership change, so consumers swap
 * their list wholesale instead of pairing task lifecycle edges. A missed bookend therefore cannot
 * wedge a stale "running" indicator.
 *
 * The level is per runtime connection, so the host resets it whenever a connection is established
 * or torn down.
 */
export type AgentSessionBackgroundTasks = AgentSessionBackgroundTask[]

export const AGENT_SESSION_BACKGROUND_TASKS_CACHE_KEY = (sessionId: string) =>
  `agent.session.background_tasks.${sessionId}` as const

/**
 * Latest task lifecycle edge for the current runtime connection. Inside a turn the same events also
 * land as hidden message parts for transcript history; this cache remains the authoritative live
 * surface for per-task background state after that turn closes.
 *
 * Keyed by task id. Drivers must not infer identity by correlating an aggregate task snapshot with
 * this edge stream unless their native protocol explicitly guarantees that relationship.
 */
export type AgentSessionTaskEvents = Record<string, AgentTaskEventPartData>

const LATE_NONTERMINAL_ENRICHMENT_FIELDS = [
  'createdAt',
  'toolUseId',
  'title',
  'subagentType',
  'taskType',
  'workflowName'
] as const satisfies ReadonlyArray<keyof AgentTaskEventPartData>

export function isTerminalAgentSessionTaskStatus(status: AgentTaskEventPartData['status'] | undefined): boolean {
  return status === 'completed' || status === 'stopped' || status === 'error'
}

/** Merge a lifecycle edge while preserving task identity and the first terminal transition. */
export function mergeAgentSessionTaskEvent(
  existing: AgentTaskEventPartData | undefined,
  incoming: AgentTaskEventPartData
): AgentTaskEventPartData {
  if (!existing) return incoming

  const merged = { ...existing }
  const existingIsTerminal = isTerminalAgentSessionTaskStatus(existing.status)
  const incomingIsTerminal = isTerminalAgentSessionTaskStatus(incoming.status)
  if (existingIsTerminal && !incomingIsTerminal) {
    for (const field of LATE_NONTERMINAL_ENRICHMENT_FIELDS) {
      const value = incoming[field]
      if (existing[field] === undefined && value !== undefined) {
        ;(merged as Record<keyof AgentTaskEventPartData, unknown>)[field] = value
      }
    }
    return merged
  }

  for (const [field, value] of Object.entries(incoming) as Array<
    [keyof AgentTaskEventPartData, AgentTaskEventPartData[keyof AgentTaskEventPartData]]
  >) {
    if (value === undefined) continue
    if (field === 'createdAt' && existing.createdAt !== undefined) continue
    if (existingIsTerminal && (field === 'event' || field === 'status' || field === 'completedAt')) continue
    if (field === 'usage') {
      const existingUsage = existing.usage
      const incomingUsage = incoming.usage
      merged.usage = {
        ...existingUsage,
        ...incomingUsage,
        ...(existingUsage?.totalTokens !== undefined || incomingUsage?.totalTokens !== undefined
          ? { totalTokens: Math.max(existingUsage?.totalTokens ?? 0, incomingUsage?.totalTokens ?? 0) }
          : {}),
        ...(incomingIsTerminal && incomingUsage?.toolUses !== undefined
          ? { toolUses: incomingUsage.toolUses }
          : existingUsage?.toolUses !== undefined || incomingUsage?.toolUses !== undefined
            ? { toolUses: Math.max(existingUsage?.toolUses ?? 0, incomingUsage?.toolUses ?? 0) }
            : {}),
        ...(incomingIsTerminal && incomingUsage?.durationMs !== undefined
          ? { durationMs: incomingUsage.durationMs }
          : existingUsage?.durationMs !== undefined || incomingUsage?.durationMs !== undefined
            ? { durationMs: Math.max(existingUsage?.durationMs ?? 0, incomingUsage?.durationMs ?? 0) }
            : {})
      }
      continue
    }
    ;(merged as Record<keyof AgentTaskEventPartData, unknown>)[field] = value
  }
  return merged
}

export const AGENT_SESSION_TASK_EVENTS_CACHE_KEY = (sessionId: string) =>
  `agent.session.task_events.${sessionId}` as const
