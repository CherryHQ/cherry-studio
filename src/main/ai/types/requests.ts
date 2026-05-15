/**
 * Request shapes shared between `AiService` and `stream-manager`.
 */
import type { Assistant } from '@shared/data/types/assistant'
import type { UniqueModelId } from '@shared/data/types/model'
import type { ChatTransport, UIMessage } from 'ai'

import type { PendingMessageQueue } from '../agent/loop/PendingMessageQueue'

/**
 * IPC-safe per-request transport config.
 *
 * Every field here can survive Electron's structured-clone (strings,
 * numbers, plain records). Use this type on **preload bridge / IPC
 * handler** signatures so renderer-supplied payloads cannot smuggle in
 * non-serialisable fields like `AbortSignal`.
 */
export interface AiTransportOptions {
  /**
   * Extra request headers layered on top of provider-level defaults
   * (`defaultAppHeaders()` + `provider.settings.extraHeaders`).
   *
   * Standard spread semantics — caller values win on key conflict; no
   * User-Agent concatenation, no key lowercasing. If you need the latter,
   * do it at the call site before handing the object in.
   */
  headers?: Record<string, string | undefined>

  /**
   * Idle-chunk timeout in milliseconds for streaming requests. The timer
   * resets on every chunk received from the provider; the request aborts
   * when the stream is silent for `timeout` ms. Falls back to
   * `DEFAULT_TIMEOUT` (30 min).
   *
   * Only honoured by streaming flows that go through `AiStreamManager`.
   * Non-streaming flows rely on `signal` for cancellation.
   */
  timeout?: number

  /**
   * Override AI SDK transparent-retry count. Defaults to `0` because
   * transparent retries can duplicate stream state inside the
   * multi-iteration tool loop. Safe to raise for non-streaming flows
   * (`generateText`, `embedMany`) when the caller tolerates idempotent
   * retries.
   */
  maxRetries?: number
}

/** Base fields shared by all AI requests. */
export interface AiBaseRequest {
  assistantId?: string
  /** Model identifier in "providerId::modelId" format. */
  uniqueModelId?: UniqueModelId
  mcpToolIds?: string[]
  requestOptions?: AiTransportOptions
}

export type ChatTrigger = Parameters<ChatTransport<UIMessage>['sendMessages']>[0]['trigger']

/** Streaming chat request built inside Main after renderer IPC dispatch has resolved context. */
export interface AiStreamRequest extends AiBaseRequest {
  /** Main-process resolved assistant config. Set by stream-manager after DataApi/Preference lookup. */
  runtimeAssistant?: Assistant
  /** Used by AiService for chunk routing. In AiStreamManager path this is set to topicId. */
  chatId: string
  trigger: ChatTrigger
  messageId?: string
  messages?: UIMessage[]
  knowledgeBaseIds?: string[]
  pendingMessages?: PendingMessageQueue
}
