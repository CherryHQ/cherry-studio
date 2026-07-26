import type { SDKBackgroundTasksChangedMessage } from '@anthropic-ai/claude-agent-sdk'

import type { AgentTaskEventPartData } from '../data/types/uiParts'

/**
 * Live background work registered in a Claude Agent SDK session (shells, subagents, monitors,
 * workflows). Background tasks outlive the turn that spawned them, so this rides shared cache as
 * session-scoped status rather than conversation content — a turn's message stream is already
 * closed by the time most of these events arrive.
 *
 * The driver returns the SDK's payload verbatim, so alias the SDK type rather than hand-mirroring
 * it — a shape change surfaces at compile time instead of silently diverging the cached contract.
 */
export type AgentSessionBackgroundTask = SDKBackgroundTasksChangedMessage['tasks'][number]

/**
 * REPLACE semantics: the SDK emits the full set on every membership change, so consumers swap their
 * list wholesale instead of pairing `task_started` / `task_notification` edges. A missed bookend
 * therefore cannot wedge a stale "running" indicator.
 *
 * The level is per CLI process and nothing is emitted at startup, so the host resets to an empty
 * list whenever a session's connection is (re)established or torn down.
 */
export type AgentSessionBackgroundTasks = AgentSessionBackgroundTask[]

export const AGENT_SESSION_BACKGROUND_TASKS_CACHE_KEY = (sessionId: string) =>
  `agent.session.background_tasks.${sessionId}` as const

/**
 * Task lifecycle reported after the turn that spawned the work ended. Inside a turn these land as
 * hidden message parts; once its stream is closed there is no message to carry them, so the latest
 * event per task rides shared cache instead and the UI merges it onto the part-derived rows.
 *
 * Keyed by task id, which is legitimate here: the SDK only forbids correlating the
 * `background_tasks_changed` level with the edge stream, and `task_started` / `task_notification`
 * are both edges.
 */
export type AgentSessionTaskEvents = Record<string, AgentTaskEventPartData>

export const AGENT_SESSION_TASK_EVENTS_CACHE_KEY = (sessionId: string) =>
  `agent.session.task_events.${sessionId}` as const
