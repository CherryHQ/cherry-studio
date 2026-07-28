import type { TopicStreamStatus } from './stream'

/**
 * The single classification of a topic's turn state, derived ONLY from the
 * cross-process `topic.stream.statuses` shared-cache status (the one
 * authority). Every renderer consumer (menubar visibility, beat-loader,
 * SWR-refresh trigger, awaiting-approval indicator) must read these flags
 * instead of re-deriving the same fact from `message.status`, message-part
 * scans, or overlay `lastGood`/`finalIds` heuristics.
 *
 * The mapping is declarative data (`TURN_STATE`), not control flow:
 * `Record<TopicStreamStatus, TurnStateFlags>` is exhaustive by construction —
 * adding a `TopicStreamStatus` value without a row is a compile error, which
 * structurally prevents the "fix one gate, miss another" whack-a-mole.
 */
export interface TurnStateFlags {
  /** Stream is actively producing or about to (`pending` | `streaming`). */
  isStreamLive: boolean
  /**
   * The turn is not complete from the user's POV — either the stream is live
   * OR it is paused waiting for the user (tool approval). Drives "hide the
   * message menubar / show the beat-loader / don't render as finished".
   */
  isTurnActive: boolean
  /** Specifically paused waiting for the user to approve/deny a tool call. */
  isAwaitingApproval: boolean
  /**
   * The original stream has ended — ANY terminal, including
   * `awaiting-approval` (the stream stopped to wait for the user; Main has
   * persisted the row). This is the single "re-read DB" trigger.
   */
  isTerminal: boolean
}

const NO_STREAM: TurnStateFlags = {
  isStreamLive: false,
  isTurnActive: false,
  isAwaitingApproval: false,
  isTerminal: false
}

/** Declarative status → flags table. Exhaustive over `TopicStreamStatus`. */
export const TURN_STATE: Record<TopicStreamStatus, TurnStateFlags> = {
  pending: {
    isStreamLive: true,
    isTurnActive: true,
    isAwaitingApproval: false,
    isTerminal: false
  },
  streaming: {
    isStreamLive: true,
    isTurnActive: true,
    isAwaitingApproval: false,
    isTerminal: false
  },
  done: {
    isStreamLive: false,
    isTurnActive: false,
    isAwaitingApproval: false,
    isTerminal: true
  },
  aborted: {
    isStreamLive: false,
    isTurnActive: false,
    isAwaitingApproval: false,
    isTerminal: true
  },
  error: {
    isStreamLive: false,
    isTurnActive: false,
    isAwaitingApproval: false,
    isTerminal: true
  },
  'awaiting-approval': {
    isStreamLive: false,
    isTurnActive: true,
    isAwaitingApproval: true,
    isTerminal: true
  }
}

/** Classify a topic's turn state from its shared-cache status. */
export function classifyTurn(status: TopicStreamStatus | undefined): TurnStateFlags {
  return status ? TURN_STATE[status] : NO_STREAM
}
