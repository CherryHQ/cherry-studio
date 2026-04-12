import type { UIMessageChunk } from 'ai'

import type { CherryMessagePart, CherryUIMessage } from '../../data/types/message'
import type { SerializedError } from '../../types/error'

// ── Push payloads (Main → Renderer) ─────────────────────────────────

/** A single chunk of a running stream. */
export interface StreamChunkPayload {
  topicId: string
  chunk: UIMessageChunk
}

/** Stream ended. */
export interface StreamDonePayload {
  topicId: string
  /** 'success' = natural completion; 'paused' = user-initiated abort with partial output. */
  status: 'success' | 'paused'
}

/** Stream error. */
export interface StreamErrorPayload {
  topicId: string
  error: SerializedError
}

// ── Request payloads (Renderer → Main) ──────────────────────────────

/**
 * Open a new stream or steer an existing one.
 *
 * Renderer sends the minimum required: topicId, parent anchor, and user content.
 * Main resolves everything else (assistant, provider, model, tools, overrides)
 * from the topic's assistant config via DB.
 */
export interface AiStreamOpenRequest {
  topicId: string
  /** Explicit parent node — message id at the current branch tip, or null for first message. */
  parentAnchorId: string | null
  /** User message content — Main wraps into a full Message when persisting. */
  userMessageParts: CherryMessagePart[]
}

/** Subscribe to a topic's stream state. */
export interface AiStreamAttachRequest {
  topicId: string
}

/** Unsubscribe from a topic. */
export interface AiStreamDetachRequest {
  topicId: string
}

/** Abort the active generation on a topic. */
export interface AiStreamAbortRequest {
  topicId: string
}

/** Result of an attach attempt. */
export type AiStreamAttachResponse =
  | { status: 'not-found' }
  | { status: 'attached'; replayedChunks: number }
  | { status: 'done'; finalMessage: CherryUIMessage }
  | { status: 'error'; error: SerializedError }

/** Result of an open attempt. */
export interface AiStreamOpenResponse {
  mode: 'started' | 'steered'
}
