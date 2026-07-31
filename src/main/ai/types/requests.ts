import type { ProviderOptions } from '@ai-sdk/provider-utils'
import type { ChatTransport, ToolChoice, ToolSet, UIMessage } from 'ai'

import type { SourceSnapshot } from '@data/services/AiUsageRecordService'
import type { RetainedContext } from '@main/ai/messages/retainedContext'
import type { ServiceTierSelection, UniqueModelId } from '@shared/data/types/model'
import type { ReasoningEffortOption } from '@shared/types/aiSdk'

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

/** In-process-only usage correlation; never accepted on renderer IPC schemas. */
export interface InProcessUsageContext {
  agentSessionId: string
  /** Assistant message that owns this request: a reserved steer continuation or the active turn. */
  assistantMessageId: string
  /** Immutable source captured by the owning Agent turn. `null` means intentionally unavailable. */
  source: SourceSnapshot | null
}

/** Identifies which layer owns history shaping for an in-process AI request. */
export type ContextOwner = 'cherry' | 'caller'

/**
 * First-class per-request overrides for callers that have no assistant to derive
 * settings from (the API gateway). Merged at highest precedence inside
 * `buildAgentParams` — NOT applied as a post-hoc plugin mutation.
 *
 * IN-PROCESS ONLY: `tools` carries an AI SDK `ToolSet` (functions / zod schemas)
 * which is not structured-clone-safe, so `callOverrides` must never be set on the
 * renderer/IPC path — same constraint as `AbortSignal` (see `AsInProcess`).
 */
export interface CallOverrides {
  temperature?: number
  maxOutputTokens?: number
  topP?: number
  topK?: number
  stopSequences?: string[]
  /** Client tool definitions WITHOUT `execute` — the model emits the call and the gateway forwards it. */
  tools?: ToolSet
  toolChoice?: ToolChoice<ToolSet>
  providerOptions?: ProviderOptions
}

export interface AiBaseRequest {
  assistantId?: string
  /** "providerId::modelId" */
  uniqueModelId?: UniqueModelId
  mcpToolIds?: string[]
  /** Selected API key override, currently used by provider health checks. */
  apiKeyOverride?: string
  /** Canonical per-turn reasoning selection captured when the message was submitted. */
  reasoningEffort?: ReasoningEffortOption
  /** Canonical provider request tier captured when the message was submitted. */
  serviceTier?: ServiceTierSelection
  /** Whether the turn requests the provider-model pair's Fast transport. */
  fastMode?: boolean
  /**
   * Knowledge bases selected for this turn. Scope is resolved by `resolveKnowledgeBaseScope`: when
   * the assistant has its own bound bases they are a ceiling — these ids may narrow that binding but
   * never widen it, and are ignored entirely when none of them falls inside it. Only when the
   * assistant has no binding does this selection define the scope on its own.
   */
  knowledgeBaseIds?: string[]
  requestOptions?: AiTransportOptions
  /**
   * Main-internal context ownership. Omitted means Cherry-managed; caller-owned
   * requests bypass Cherry's history truncation, pruning, and compaction.
   * This field is intentionally absent from renderer IPC schemas.
   */
  contextOwner?: ContextOwner
  /** Per-request overrides (in-process only; assistant-less callers like the API gateway). */
  callOverrides?: CallOverrides
}

/**
 * Provider-scoped request without a model (ai.provider.model.list). Falls back to
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
  /**
   * Context that must survive durable compaction (attachment allow-list,
   * persisted-output blob paths), computed from the RAW message path before
   * folding removes it from `messages`. Main-internal (the renderer sends the
   * smaller AiStreamOpenRequest, so this never crosses IPC). Absent →
   * consumers fall back to scanning `messages`.
   */
  retainedContext?: RetainedContext
  runtime?: { kind: 'agent-session'; sessionId: string; turnId: string }
  /**
   * Attribution for callers with no assistant to derive it from. Neutral on purpose:
   * the agent-only `usageContext` also rewrites `chatId` to an agent session id, so
   * reusing it would record a mini app's call as an agent turn.
   */
  source?: SourceSnapshot | null
}
