import type { UniqueModelId } from '@shared/data/types/model'
import type { ChatTransport, UIMessage } from 'ai'

/**
 * IPC-safe per-request transport config. Every field here survives
 * Electron's structured-clone — used on preload-bridge / IPC-handler
 * signatures so renderer payloads can't smuggle in `AbortSignal`.
 */
export interface AiTransportOptions {
  /** Layered on top of `defaultAppHeaders()` + `provider.settings.extraHeaders`; caller wins on conflict. */
  headers?: Record<string, string | undefined>
  /** Idle-chunk timeout (ms) for streaming flows; resets per chunk. Falls back to `DEFAULT_TIMEOUT` (30 min). */
  timeout?: number
  /** AI SDK transparent-retry override. Defaults to 0 — retries can duplicate stream state in tool loops. */
  maxRetries?: number
}

export interface AiBaseRequest {
  assistantId?: string
  /** "providerId::modelId" */
  uniqueModelId?: UniqueModelId
  mcpToolIds?: string[]
  requestOptions?: AiTransportOptions
}

/**
 * Provider-scoped request without a model (Ai_ListModels). Falls back to
 * the assistant's bound model's provider when only `assistantId` is given.
 * `throwOnError` surfaces upstream failures (used by model-sync UX).
 */
export interface ListModelsRequest {
  providerId?: string
  assistantId?: string
  throwOnError?: boolean
}

export type ChatTrigger = Parameters<ChatTransport<UIMessage>['sendMessages']>[0]['trigger']

/** Streaming chat request — serialisable across IPC. */
export interface AiStreamRequest extends AiBaseRequest {
  /** `topicId` in the AiStreamManager path. */
  chatId: string
  trigger: ChatTrigger
  messageId?: string
  messages?: UIMessage[]
  runtime?: { kind: 'agent-session'; sessionId: string; turnId: string }
}
