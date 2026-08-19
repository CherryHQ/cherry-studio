import { application } from '@application'
import type { DbTxWithEffects } from '@data/db/types'
import { agentSessionMessageService } from '@main/data/services/AgentSessionMessageService'
import type { CreateUserMessageWithPlaceholdersInput } from '@main/data/services/MessageService'
import { messageService } from '@main/data/services/MessageService'
import type { AttemptId } from '@shared/ai/attempt'
import type {
  AgentSessionMessageEntity,
  CreateAgentSessionMessagesDto
} from '@shared/data/api/schemas/agentSessionMessages'
import type { Message, MessageData } from '@shared/data/types/message'

import type { ActiveNodeDecision } from './admission'
import type { PreparedTopicCommit, TopicCommitReceipt, TopicStreamAggregate } from './TopicStreamAggregate'

/**
 * The rows one dispatch writes, as data. `activeNodeDecision` is deliberately absent: it is
 * decided during admission and filled in by the writer, so a caller cannot supply a stale one.
 */
export type PreparedDispatchRows =
  | { kind: 'none' }
  | {
      kind: 'user-with-placeholders'
      input: Omit<CreateUserMessageWithPlaceholdersInput, 'activeNodeDecision'>
    }
  | { kind: 'reset-for-retry'; messageId: string }
  | { kind: 'update-anchor'; messageId: string; data: MessageData }
  | {
      kind: 'agent-session-messages'
      input: CreateAgentSessionMessagesDto
      expectedAgentId?: string
    }
  /**
   * A caller-owned write that must run inside the dispatch's own transaction — the agent path
   * persists user row, assistant placeholder and trace id together.
   *
   * `write` is synchronous by construction: `withWriteTx` bodies cannot await (better-sqlite3 is
   * synchronous), so nothing interleaves between the durable write and the runtime CAS, which is
   * what T4 exists to guarantee. It is not an escape hatch for async work.
   */
  | { kind: 'tx-write'; write: (tx: DbTxWithEffects) => unknown }

export type PreparedDispatchRowResult =
  | { kind: 'none' }
  | { kind: 'user-with-placeholders'; userMessage: Message; placeholders: Message[] }
  | { kind: 'reset-for-retry'; resetMessage: Message }
  | { kind: 'update-anchor'; anchor: Message }
  | { kind: 'agent-session-messages'; messages: AgentSessionMessageEntity[] }
  | { kind: 'tx-write'; value: unknown }

/**
 * The only writer for dispatch rows. Concrete and synchronous — each branch is one
 * `withWriteTx` inside `messageService`, so a dispatch either has its rows or has none.
 */
export function writePreparedRows(
  rows: PreparedDispatchRows,
  activeNodeDecision: ActiveNodeDecision
): PreparedDispatchRowResult {
  switch (rows.kind) {
    case 'none':
      return { kind: 'none' }
    case 'user-with-placeholders': {
      const result = messageService.createUserMessageWithPlaceholders({ ...rows.input, activeNodeDecision })
      return { kind: 'user-with-placeholders', userMessage: result.userMessage, placeholders: result.placeholders }
    }
    case 'reset-for-retry':
      return { kind: 'reset-for-retry', resetMessage: messageService.resetAssistantForRetry(rows.messageId) }
    case 'update-anchor':
      return {
        kind: 'update-anchor',
        anchor: messageService.update(rows.messageId, { data: rows.data, status: 'pending' })
      }
    case 'agent-session-messages':
      return {
        kind: 'agent-session-messages',
        messages: agentSessionMessageService.saveMessages(rows.input, rows.expectedAgentId)
      }
    case 'tx-write':
      return { kind: 'tx-write', value: application.get('DbService').withWriteTx(rows.write) }
  }
}

export interface PreparedDispatchCommit {
  readonly topic: TopicStreamAggregate
  readonly preparedTopic: PreparedTopicCommit
  readonly rows: PreparedDispatchRows
  readonly activeNodeDecision: ActiveNodeDecision
  readonly attemptIds: readonly AttemptId[]
}

export interface DispatchCommitResult {
  readonly receipt: TopicCommitReceipt
  readonly rows: PreparedDispatchRowResult
  readonly attemptIds: readonly AttemptId[]
}

/**
 * The single dispatch commit entry (T4). Deliberately not `async`, non-generic, and
 * callback-free: durable rows land first, then the runtime CAS, with no `await` between them
 * and no way for a caller to inject work into the gap.
 *
 * A DB throw leaves the runtime untouched. A CAS failure after the write is an invariant
 * violation, not a compensation point — the committed `pending` row stays owned by boot
 * reconciliation, exactly as it would after a crash in the same window.
 */
export function commitPreparedDispatch(input: PreparedDispatchCommit): DispatchCommitResult {
  input.topic.validate(input.preparedTopic)
  const rows = writePreparedRows(input.rows, input.activeNodeDecision)
  const receipt = input.topic.commit(input.preparedTopic)
  return { receipt, rows, attemptIds: input.attemptIds }
}
