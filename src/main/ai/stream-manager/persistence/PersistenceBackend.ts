/**
 * Persistence backend strategy — the storage-specific half of a
 * `PersistenceListener`.
 *
 * Three implementations cover the three Cherry Studio chat topologies:
 *  - `MessageServiceBackend`    — SQLite message tree (Persistent topics)
 *  - `TemporaryChatBackend`     — in-memory topic (Temporary topics)
 *  - `AgentMessageBackend`      — agents DB `session_messages` (Agent sessions)
 *
 * The listener handles the observer protocol (filter by modelId, combine
 * partial + error parts, logging). Backends only do the final write —
 * making it trivial to add a fourth store (e.g. an outbox for the API
 * server) without duplicating the listener boilerplate.
 */

import type { CherryUIMessage } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'
import type { SerializedError } from '@shared/types/error'
import type { UIMessage } from 'ai'

export interface PersistAssistantInput {
  /** Always present for success/paused terminal events. */
  finalMessage: CherryUIMessage
  status: 'success' | 'paused'
  /** Set when the topic is multi-model, so a backend can tell executions apart. */
  modelId?: UniqueModelId
}

export interface PersistErrorInput {
  error: SerializedError
  /** Streamed content before the error (if any). */
  partialMessage?: UIMessage
  /** Set when the topic is multi-model. */
  modelId?: UniqueModelId
}

export interface PersistenceBackend {
  /** Human-readable tag for logging/diagnostics (e.g. "sqlite", "temp", "agents-db"). */
  readonly kind: string

  /** Persist a successful or paused assistant message. */
  persistAssistant(input: PersistAssistantInput): Promise<void>

  /** Persist an error (optionally with the partial content that streamed before it). */
  persistError(input: PersistErrorInput): Promise<void>

  /**
   * Optional post-success hook. Called only after `persistAssistant` with
   * `status: 'success'` resolves cleanly. Failures are swallowed by the
   * listener (best-effort, never retried).
   */
  afterPersist?(finalMessage: CherryUIMessage): Promise<void>
}
