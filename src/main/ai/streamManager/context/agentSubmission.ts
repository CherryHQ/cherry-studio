import type { DbOrTx } from '@data/db/types'
import type { AgentSessionMessageEntity } from '@shared/data/api/schemas/agentSessionMessages'

import type { PersistedAgentDispatch, ValidatedAgentDispatch } from './AgentChatContextProvider'

export type AgentMessageReservation =
  | { mode: 'queued'; validated: ValidatedAgentDispatch; userMessage: AgentSessionMessageEntity }
  | { mode: 'accepted'; persisted: PersistedAgentDispatch }

/** Synchronous transaction composition; a throw must roll back the reservation and caller writes together. */
export type AgentMessageCommit = (reserve: (tx: DbOrTx) => AgentMessageReservation) => AgentMessageReservation

export type AgentDispatchOptions = { commitAgentMessage?: AgentMessageCommit }
