/**
 * ChatContextProvider — resolves an `Ai_Stream_Open` request into an executing stream.
 *
 * `dispatchStreamRequest` (see `./dispatch.ts`) picks the first provider whose
 * `canHandle(topicId)` is true and delegates the whole pipeline to it (context
 * resolution, user message persistence, listener assembly, execution dispatch).
 *
 * The registry pattern replaces the old `if (isAgentSessionTopic) else normal` switch —
 * adding a new topic namespace (e.g. `temp:` for temporary chats) only requires adding
 * a new provider, never modifying the dispatcher.
 */

import type { AiStreamOpenRequest, AiStreamOpenResponse } from '@shared/ai/transport'

import type { AiStreamManager } from '../AiStreamManager'
import type { StreamListener } from '../types'

export interface ChatContextProvider {
  /** Stable identifier for logging / diagnostics. */
  readonly name: string

  /**
   * Return true if this provider owns the given topicId namespace.
   * Implementations should be synchronous and side-effect free — they run on every request.
   */
  canHandle(topicId: string): boolean

  /**
   * Resolve context, persist inputs, build listeners, and dispatch executions
   * against the manager. Must return the `Ai_Stream_Open` response.
   */
  handle(manager: AiStreamManager, subscriber: StreamListener, req: AiStreamOpenRequest): Promise<AiStreamOpenResponse>
}
