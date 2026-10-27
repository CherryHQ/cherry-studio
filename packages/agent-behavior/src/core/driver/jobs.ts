import type { JsonValue, ThreadId } from '@cherrystudio/agent-runtime'

import type { TxOp } from '../decisions'
import type { ConversationFacts } from '../facts'
import { idleDriverGeneration, type Key, keys } from '../keys'

/** Wakes the conversation's idle driver of the current generation (H4); a live one dedupes it by key. */
export const ensureDriver = (facts: Pick<ConversationFacts, 'thread' | 'history'>): TxOp => ({
  type: 'ensure-job',
  job: { kind: 'idle-driver', scope: facts.thread, input: null, onRestart: 'abandon' },
  key: keys.idleDriver(facts.thread, idleDriverGeneration(facts.history))
})

/** What a `subagent-report` job needs: the run's key (spawn or message key), number, first input text, and child when known. */
export type ReportInput = {
  readonly runKey: Key
  readonly run: number
  readonly text: string
  readonly child?: ThreadId
  /** A late message already submitted under this key; the report must not send it again under a different key. */
  readonly messageKey?: Key
}
export const ensureReport = (facts: Pick<ConversationFacts, 'thread'>, input: ReportInput): TxOp => ({
  type: 'ensure-job',
  job: { kind: 'subagent-report', scope: facts.thread, input: input satisfies JsonValue, onRestart: 'resume' },
  key: keys.subagentReport(input.runKey)
})
