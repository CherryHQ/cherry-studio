import type { AssistantModelMessage, JSONValue, ToolModelMessage, UserModelMessage } from 'ai'

/**
 * Session transcript: the append-only log the host persists so a later session can rebuild Pi's
 * state. Every entry is plain JSON. The host passes the full active path back, oldest first and
 * uncompacted; compaction happens inside Pi.
 */
export type TranscriptEntry =
  | TranscriptMessageEntry
  | TranscriptCompactionEntry
  | TranscriptContextEditEntry
  | TranscriptStateEntry

interface TranscriptEntryBase {
  /** Unique within the transcript. Emitted entries keep Pi's entry ids. */
  id: string
  /** Unix ms. For a message entry, the message's own timestamp. */
  timestamp: number
}

export type TranscriptStopReason = 'stop' | 'length' | 'toolUse' | 'error' | 'aborted'

/** Provider token counts of one reply; they anchor Pi's context accounting. */
export interface TranscriptUsage {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  reasoning?: number
}

/** Context message an extension added (Pi `custom_message`), e.g. a goal-round prompt. */
export interface TranscriptCustomMessage {
  type: string
  display: boolean
  details?: JSONValue
}

/**
 * A model-visible message in AI SDK form, plus the fields Pi needs that `ModelMessage` lacks.
 * Images are inline base64 `image` parts (user) or `image-data` outputs (tool).
 */
export interface TranscriptMessageEntry extends TranscriptEntryBase {
  kind: 'message'
  /** A `tool` message holds exactly one `tool-result` part. */
  message: UserModelMessage | AssistantModelMessage | ToolModelMessage
  /**
   * Assistant: key of the producing model. Its reasoning replays as reasoning, with signatures, only
   * to the same key; other models get it as plain text.
   */
  modelKey?: string
  /** Assistant. */
  usage?: TranscriptUsage
  /** Assistant; `stop` when absent. Pi leaves `error`/`aborted` replies out of requests. */
  stopReason?: TranscriptStopReason
  /** Assistant: the provider error of a failed reply (Pi detects context overflow from it). */
  errorMessage?: string
  /** Assistant: the provider's response id. */
  responseId?: string
  /** Tool: the tool's `details` (branch-following extension state). */
  details?: JSONValue
  /** Set when an extension added the message; it is then a `user` message. */
  custom?: TranscriptCustomMessage
}

/** Pi compaction: the context starts with `summary`, then the entries from `firstKeptEntryId` on. */
export interface TranscriptCompactionEntry extends TranscriptEntryBase {
  kind: 'compaction'
  summary: string
  /** An earlier entry, or this entry's own id when nothing before it is kept. */
  firstKeptEntryId: string
  tokensBefore: number
  details?: JSONValue
}

/** Removes an earlier message from the model context (Pi's overflow and length recovery). */
export interface TranscriptContextEditEntry extends TranscriptEntryBase {
  kind: 'context-edit'
  targetId: string
  replacement: null
}

/** Extension state (a Pi `custom` entry of a `cherry.*` type); never sent to the model. */
export interface TranscriptStateEntry extends TranscriptEntryBase {
  kind: 'state'
  type: string
  data?: JSONValue
}

/** Prefix of the Pi custom entry types that round-trip as {@link TranscriptStateEntry}. */
export const STATE_TYPE_PREFIX = 'cherry.'

/** State entry recording the tools activated beyond the session's base tools (e.g. by `tool_search`). */
export const TOOL_LOADOUT_STATE = 'cherry.tool-loadout'

export type TranscriptErrorCode =
  | 'invalid_entry'
  | 'duplicate_id'
  | 'unsupported_content'
  | 'orphan_tool_result'
  | 'compaction_boundary_missing'
  | 'edit_target_missing'

/** A transcript the package cannot rebuild a session from. No session is created. */
export class TranscriptError extends Error {
  constructor(
    readonly code: TranscriptErrorCode,
    readonly entryId: string | undefined,
    message: string
  ) {
    super(entryId === undefined ? message : `${message} (entry ${entryId})`)
    this.name = 'TranscriptError'
  }
}
