import { ConversationStatus } from '../conversation'

/**
 * The single classification of a Conversation's projected status. Every
 * renderer consumer must read these flags
 * instead of re-deriving the same fact from `message.status`, message-part
 * scans, or overlay `lastGood`/`finalIds` heuristics.
 *
 * The mapping is declarative data (`TURN_STATE`), not control flow:
 * `Record<ConversationStatus, TurnStateFlags>` is exhaustive by construction.
 */
export interface TurnStateFlags {
  /** Stream is actively producing or about to (`pending` | `streaming`). */
  isStreamLive: boolean
  /**
   * The turn is not complete from the user's POV — either the stream is live
   * OR it is paused waiting for the user. Drives "hide the
   * message menubar / show the beat-loader / don't render as finished".
   */
  isTurnActive: boolean
  /** Specifically paused waiting for a user interaction. */
  isAwaitingInteraction: boolean
  /**
   * The original stream has ended — ANY terminal, including
   * `awaiting-interaction` (the stream stopped to wait for the user; Main has
   * persisted the row). This is the single "re-read DB" trigger.
   */
  isTerminal: boolean
}

const NO_STREAM: TurnStateFlags = {
  isStreamLive: false,
  isTurnActive: false,
  isAwaitingInteraction: false,
  isTerminal: false
}

/** Declarative status → flags table. Exhaustive over `ConversationStatus`. */
export const TURN_STATE: Record<ConversationStatus, TurnStateFlags> = {
  [ConversationStatus.Pending]: {
    isStreamLive: true,
    isTurnActive: true,
    isAwaitingInteraction: false,
    isTerminal: false
  },
  [ConversationStatus.Streaming]: {
    isStreamLive: true,
    isTurnActive: true,
    isAwaitingInteraction: false,
    isTerminal: false
  },
  [ConversationStatus.Done]: {
    isStreamLive: false,
    isTurnActive: false,
    isAwaitingInteraction: false,
    isTerminal: true
  },
  [ConversationStatus.Aborted]: {
    isStreamLive: false,
    isTurnActive: false,
    isAwaitingInteraction: false,
    isTerminal: true
  },
  [ConversationStatus.Error]: {
    isStreamLive: false,
    isTurnActive: false,
    isAwaitingInteraction: false,
    isTerminal: true
  },
  [ConversationStatus.AwaitingInteraction]: {
    isStreamLive: false,
    isTurnActive: true,
    isAwaitingInteraction: true,
    isTerminal: true
  }
}

/** Classify a Conversation's shared-cache status. */
export function classifyTurn(status: ConversationStatus | undefined): TurnStateFlags {
  return status ? TURN_STATE[status] : NO_STREAM
}
