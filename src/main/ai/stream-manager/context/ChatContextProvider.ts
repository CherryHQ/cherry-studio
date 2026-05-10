/**
 * ChatContextProvider — produces a ready-to-dispatch bundle for a single
 * `Ai_Stream_Open` request.
 *
 * `dispatchStreamRequest` (see `./dispatch.ts`) picks the first provider
 * whose `canHandle(topicId)` is true, asks it to `prepareDispatch`, and
 * then calls `manager.send(...)` itself. Providers no longer own the
 * `send` call — the dispatcher does — which means:
 *
 *  - provider tests can assert on the returned `PreparedDispatch` shape
 *    without mocking any manager method;
 *  - the liveness / message-injection / multi-model fan-out contract
 *    lives in exactly one place (AiStreamManager), not replicated
 *    across providers;
 *  - adding a new chat topology (e.g. "inbox:", "shared-agent:") only
 *    requires writing a provider, never touching the dispatcher.
 */

import type { Message } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'

import type { AiStreamRequest } from '../../types/requests'
import type { StreamListener } from '../types'
import type { MainDispatchRequest } from './dispatch'

/**
 * The bundle a provider produces so the dispatcher can call `manager.send`
 * in a single, uniform way.
 */
export interface PreparedDispatch {
  topicId: string
  /** One entry per execution the provider wants to launch. */
  models: ReadonlyArray<{ modelId: UniqueModelId; request: AiStreamRequest }>
  /** Subscriber + per-execution PersistenceListeners, already assembled. */
  listeners: StreamListener[]
  /**
   * Follow-up user message to inject into the active stream when the
   * topic already has one running (inject path). Providers that do not
   * support mid-stream message injection leave this undefined.
   */
  userMessage?: Message
  /** Shared sibling group for multi-model parallel responses. */
  siblingsGroupId?: number
  /**
   * True when the provider intends to surface `executionIds` back to the
   * Renderer (multi-model UI). Single-model topics set this to false so
   * the response schema stays backwards compatible.
   */
  isMultiModel: boolean
}

/**
 * Optional context the dispatcher passes to providers — currently a single
 * flag indicating whether the manager already has a live stream on this
 * topic. Providers that need to vary persistence work between the start
 * path (no live stream) and the inject path (live stream — `models` is
 * ignored, only `userMessage` is consumed) read this hint instead of
 * importing the manager directly.
 */
export interface DispatchContext {
  /** True when `manager.send()` will take the inject branch. */
  hasLiveStream: boolean
}

export interface ChatContextProvider {
  /** Stable identifier for logging / diagnostics. */
  readonly name: string

  /**
   * Return true if this provider owns the given topicId namespace.
   * Implementations must be synchronous and side-effect free — they run
   * on every request.
   */
  canHandle(topicId: string): boolean

  /**
   * Resolve context, persist user inputs, allocate placeholders, and
   * assemble the listener set + per-model requests. The dispatcher calls
   * `manager.send(...)` with the returned bundle.
   */
  prepareDispatch(subscriber: StreamListener, req: MainDispatchRequest, ctx: DispatchContext): Promise<PreparedDispatch>
}
