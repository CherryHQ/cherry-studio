import type { UIMessageChunk } from 'ai'

import type { CherryMessagePart, CherryUIMessage } from '../../data/types/message'
import type { Model } from '../../data/types/model'
import type { SerializedError } from '../../types/error'

// ── Push payloads (Main → Renderer) ─────────────────────────────────

/** A single chunk of a running stream. */
export interface StreamChunkPayload {
  topicId: string
  /** Multi-model: identifies which execution produced this chunk (UniqueModelId). */
  executionId?: string
  chunk: UIMessageChunk
}

/** Stream ended. */
export interface StreamDonePayload {
  topicId: string
  /** Multi-model: identifies which execution finished. */
  executionId?: string
  /** 'success' = natural completion; 'paused' = user-initiated abort with partial output. */
  status: 'success' | 'paused'
}

/** Stream error. */
export interface StreamErrorPayload {
  topicId: string
  /** Multi-model: identifies which execution errored. */
  executionId?: string
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
  /** Explicit parent node — message id at the current branch tip. Omit to let Main auto-resolve. */
  parentAnchorId?: string
  /** User message content — Main wraps into a full Message when persisting. */
  userMessageParts: CherryMessagePart[]
  /** Models @-mentioned by the user — Main dispatches one stream per model for comparison. */
  mentionedModels?: Model[]
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
  | { status: 'attached'; bufferedChunks: UIMessageChunk[] }
  | { status: 'done'; finalMessage: CherryUIMessage }
  | { status: 'error'; error: SerializedError }

/** Result of an open attempt. */
export interface AiStreamOpenResponse {
  mode: 'started' | 'steered'
  /** Multi-model: execution IDs (UniqueModelId) for chunk demux. Empty/undefined for single-model. */
  executionIds?: string[]
}
