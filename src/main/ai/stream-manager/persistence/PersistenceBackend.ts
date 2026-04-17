/**
 * Persistence backend strategy — the storage-specific half of a
 * `PersistenceListener`.
 *
 * Three implementations cover the three Cherry Studio chat topologies:
 *  - `MessageServiceBackend`    — SQLite message tree (Persistent topics)
 *  - `TemporaryChatBackend`     — in-memory topic (Temporary topics)
 *  - `AgentMessageBackend`      — agents DB `session_messages` (Agent sessions)
 *
 * `success` / `paused` / `error` are the three terminal statuses of an
 * execution, and they all share a single accumulated `finalMessage`
 * (produced by the manager's pump via `readUIMessageStream`). The
 * listener is responsible for attaching an error part to the message
 * before calling the backend, so backends never need to know how to
 * synthesise an error-shaped UIMessage — they just persist whatever
 * accumulated parts they receive with the right status.
 */

import type { CherryUIMessage } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'

export interface PersistAssistantInput {
  /**
   * Accumulated UIMessage for this execution. May be undefined when the
   * stream errored before producing any chunks. Backends that cannot
   * persist an empty message should ignore those cases and warn.
   */
  finalMessage?: CherryUIMessage
  status: 'success' | 'paused' | 'error'
  /** Set when the topic is multi-model, so backends can tell executions apart. */
  modelId?: UniqueModelId
}

export interface PersistenceBackend {
  /** Human-readable tag for logging/diagnostics (e.g. "sqlite", "temp", "agents-db"). */
  readonly kind: string

  /** Persist the terminal assistant turn in any of the three statuses. */
  persistAssistant(input: PersistAssistantInput): Promise<void>

  /**
   * Optional post-success hook. Called only after `persistAssistant` with
   * `status: 'success'` resolves cleanly. Failures are swallowed by the
   * listener (best-effort, never retried).
   */
  afterPersist?(finalMessage: CherryUIMessage): Promise<void>
}
