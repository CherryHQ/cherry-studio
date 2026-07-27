import type { AgentTaskEventPartData } from '../data/types/uiParts'

/**
 * Runtime-neutral background work that outlives the turn which spawned it. Drivers normalize their
 * native task payloads into this app-owned shape before crossing the runtime boundary.
 */
export type AgentSessionBackgroundTask = {
  id: string
  type: string
  description: string
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

export const AGENT_SESSION_TASK_EVENTS_CACHE_KEY = (sessionId: string) =>
  `agent.session.task_events.${sessionId}` as const
