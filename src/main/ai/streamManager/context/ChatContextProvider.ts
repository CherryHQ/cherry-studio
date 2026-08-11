/**
 * ChatContextProvider — produces a ready-to-dispatch bundle for one
 * `Ai_Stream_Open` request. `dispatchStreamRequest` picks the first
 * provider whose `canHandle(topicId)` matches, asks it to prepare, and
 * calls `manager.send(...)` itself. See `docs/references/ai/stream-manager.md`.
 */

import type { Span } from '@opentelemetry/api'
import type { CherryUIMessage, MessageRuntimeTiming } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'
import type { ReasoningEffortOption } from '@shared/types/aiSdk'

import type { AiStreamRequest } from '../../types'
import type { StreamLifecycle } from '../lifecycle/StreamLifecycle'
import type { StreamListener } from '../types'
import type { MainDispatchRequest } from './dispatch'

export type PreparedLiveExecutionChange =
  | { mode: 'replace' }
  | {
      mode: 'append'
      groupAnchorMessageId: string
      /** Activate the reserved assistant if the live stream settles during preparation. */
      activateFallback: boolean
    }

export interface PreparedDispatch {
  topicId: string
  models: ReadonlyArray<{
    modelId: UniqueModelId
    request: AiStreamRequest
    runtimeTimingSeed?: MessageRuntimeTiming
    /** Renderer readers must not seed this execution from cached anchor parts. */
    seedFromEmpty?: boolean
    rootSpan?: Span
    abortController?: AbortController
  }>
  listeners: StreamListener[]
  /**
   * Set only by the persistent provider's live-submit (steer) branch: the id of the steer user row to
   * enqueue. Its presence is the explicit signal that this dispatch is enqueue-only — the dispatcher
   * reads it instead of structurally inferring the steer branch from `models.length === 0`.
   */
  pendingSteerUserMessageId?: string
  /** Canonical selection captured alongside the pending steer. */
  pendingSteerReasoningEffort?: ReasoningEffortOption
  /** Fast selection captured alongside the pending steer. */
  pendingSteerFastMode?: boolean
  /** Persisted user/assistant skeletons created for this dispatch. */
  reservedMessages?: CherryUIMessage[]
  /** Shared sibling group for multi-model parallel responses. */
  siblingsGroupId?: number
  /** Change one execution in the current live reply group. */
  liveExecutionChange?: PreparedLiveExecutionChange
  /** Reservation intentionally did not move the topic's active node. */
  preserveActiveNode?: boolean
  /** Strategy for status broadcast, attach gating, cleanup. Omit → `chatLifecycle`. */
  lifecycle?: StreamLifecycle
}

export interface DispatchContext {
  /** True when the topic has a live stream at initial dispatch admission. */
  hasLiveStream: boolean
  /** Reject instead of enqueueing when the runtime becomes busy during preparation. */
  requireIdle?: boolean
  /** Internal callers may require the session's agent ownership at the message-write boundary. */
  expectedAgentId?: string
  /** Stable snapshot taken with `hasLiveStream`; includes terminal siblings retained by the live turn. */
  activeExecutions?: ReadonlyArray<{
    modelId: UniqueModelId
    anchorMessageId?: string
    siblingsGroupId?: number
  }>
}

export interface ChatContextProvider {
  readonly name: string

  /** Synchronous, side-effect free — runs on every request. */
  canHandle(topicId: string): boolean

  prepareDispatch(subscriber: StreamListener, req: MainDispatchRequest, ctx: DispatchContext): Promise<PreparedDispatch>
}
