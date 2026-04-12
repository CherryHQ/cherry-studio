import type { UIMessage, UIMessageChunk } from 'ai'

import type { CherryUIMessage } from '../../data/types/message'
import type { SerializedError } from '../../types/error'
import type { AiAssistantRuntimeOverrides } from './index'

// ── Push payloads (Main → Renderer) ─────────────────────────────────

/**
 * A single chunk of a running stream.
 *
 * Uses AI SDK's `UIMessageChunk` (the wide type that `streamText` produces),
 * not `CherryUIMessageChunk` (the narrowed app-specific type). The transport
 * layer carries whatever the AI SDK emits; narrowing to Cherry-specific data
 * part types happens at the consumption site (Renderer rendering).
 */
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

/** Open a new stream or steer an existing one. */
export interface AiStreamOpenRequest {
  /** Optional dedup token for rapid-retry detection. */
  requestId?: string
  topicId: string
  /**
   * Explicit parent node anchor — the message id at the current branch tip.
   * Main uses this as `parentId` for `messageService.create`, never falling
   * back to `topic.activeNodeId`.
   */
  parentAnchorId: string | null
  /**
   * User message content (no id — Main generates the real SQLite id).
   * Uses generic `UIMessage['parts']` rather than `CherryUIMessage['parts']`
   * because the transport layer should not enforce app-specific data part types.
   */
  userMessage: {
    role: 'user'
    data: { parts: UIMessage['parts'] }
  }
  /** Assistant id for the response message metadata. */
  assistantId: string
  /** Provider id for model resolution. */
  providerId?: string
  /** Model id for model resolution. */
  modelId?: string
  /** Enabled MCP tool IDs. */
  mcpToolIds?: string[]
  /** Knowledge base IDs for RAG. */
  knowledgeBaseIds?: string[]
  /** Runtime assistant overrides. */
  assistantOverrides?: AiAssistantRuntimeOverrides
  /** Chat history (optional — Main reads from DB in AiStreamManager path). */
  messages?: CherryUIMessage[]
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
  mode: 'started' | 'steered' | 'deduped'
}
