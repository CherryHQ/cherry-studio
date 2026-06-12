/**
 * ChatContextProvider — produces a ready-to-dispatch bundle for one
 * `Ai_Stream_Open` request. `dispatchStreamRequest` picks the first
 * provider whose `canHandle(topicId)` matches, asks it to prepare, and
 * calls `manager.send(...)` itself. See `docs/references/ai/stream-manager.md`.
 */

import type { Span } from '@opentelemetry/api'
import type { CherryUIMessage } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'

import type { AiStreamRequest } from '../../types/requests'
import type { StreamLifecycle } from '../lifecycle/StreamLifecycle'
import type { StreamListener } from '../types'
import type { MainDispatchRequest } from './dispatch'

export interface PreparedDispatch {
  topicId: string
  models: ReadonlyArray<{ modelId: UniqueModelId; request: AiStreamRequest; rootSpan?: Span }>
  listeners: StreamListener[]
  /** DB id of the user message row this dispatch created, surfaced back to renderer for optimistic join. */
  userMessageId?: string
  /**
   * Set only by the persistent provider's live-submit (steer) branch: the id of the steer user row to
   * enqueue. Its presence is the explicit signal that this dispatch is enqueue-only — the dispatcher
   * reads it instead of structurally inferring the steer branch from `models.length === 0`.
   */
  pendingSteerUserMessageId?: string
  /** Persisted user/assistant skeletons created for this dispatch. */
  reservedMessages?: CherryUIMessage[]
  /** Shared sibling group for multi-model parallel responses. */
  siblingsGroupId?: number
  /** True when the response should surface `executionIds` (multi-model UI). */
  isMultiModel: boolean
  /** Strategy for status broadcast, attach gating, cleanup. Omit → `chatLifecycle`. */
  lifecycle?: StreamLifecycle
}

export interface DispatchContext {
  /** True when `manager.send()` will take the inject branch. */
  hasLiveStream: boolean
}

export interface ChatContextProvider {
  readonly name: string

  /** Synchronous, side-effect free — runs on every request. */
  canHandle(topicId: string): boolean

  prepareDispatch(subscriber: StreamListener, req: MainDispatchRequest, ctx: DispatchContext): Promise<PreparedDispatch>
}
