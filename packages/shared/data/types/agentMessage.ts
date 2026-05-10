/**
 * Wire shape for `agent_session_message.content` (JSON column) and the
 * exchange I/O types the persistence service exposes.
 *
 * Two `blocks` fields exist for legacy reasons:
 *  - The outer `AgentPersistedMessage.blocks` is an array of v1 block
 *    OBJECTS (e.g. `{ id, messageId, type, createdAt, status, content }`).
 *  - The inner `AgentPersistedMessageContent.blocks` is an array of
 *    block-ID STRINGS — the v1 envelope's index into the outer array.
 * Both are deprecated; v2 readers consume `message.data.parts` instead and
 * leave both as `[]` on new writes.
 */

import type { AgentSessionMessageEntity } from '../api/schemas/agents'
import type { SessionMessageRole } from './agent'
import type { CherryMessagePart } from './message'

/** Legacy block object as written by main's persistence path. The actual
 *  variants in flight are `main_text` (with `content`) and `image` (with
 *  `url`); we keep the optional fields union-style instead of discriminating
 *  because no current reader walks them. */
export interface LegacyAgentMessageBlock {
  id: string
  messageId: string
  type: 'main_text' | 'image' | string
  createdAt: string
  status: string
  /** Present on `main_text` blocks. */
  content?: string
  /** Present on `image` blocks (data URL). */
  url?: string
}

/** Persisted shape for an agent session message row's `content` column. */
export interface AgentPersistedMessage {
  message: AgentPersistedMessageContent
  /** @deprecated Empty after blocks→parts migration. Legacy block objects
   *  for un-migrated rows. */
  blocks: LegacyAgentMessageBlock[]
}

/** v2 message envelope. New parts live under `data.parts`; legacy block-id
 *  list under `blocks` exists only for un-migrated rows. */
export interface AgentPersistedMessageContent {
  id: string
  role: SessionMessageRole
  assistantId?: string
  topicId?: string
  createdAt?: string
  status?: string
  /** Assistant-only: model id used for the response. */
  modelId?: string
  /** v2 message data — readers should consume this. */
  data?: { parts?: CherryMessagePart[] }
  /** @deprecated v1 block-id list. */
  blocks?: string[]
}

/** Per-side persistence input. User and assistant carry the same fields;
 *  the only contextual difference (whether `agentSessionId` is required)
 *  is enforced at the call site, not in this payload.
 *
 *  `metadata` semantics on upsert:
 *  - `undefined` → keep existing row's metadata
 *  - `null`      → clear existing metadata
 *  - object      → replace */
export interface AgentMessagePersistInput {
  payload: AgentPersistedMessage
  metadata?: Record<string, unknown> | null
  createdAt?: string
}

/** Input to `persistExchange`. */
export interface AgentMessageExchangeInput {
  sessionId: string
  agentSessionId: string
  user?: AgentMessagePersistInput
  assistant?: AgentMessagePersistInput
}

/** Output of `persistExchange` — entities for whatever sides were written. */
export interface AgentMessageExchangeOutput {
  userMessage?: AgentSessionMessageEntity
  assistantMessage?: AgentSessionMessageEntity
}
