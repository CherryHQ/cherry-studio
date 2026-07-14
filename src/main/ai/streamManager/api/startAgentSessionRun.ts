import { application } from '@application'
import type { CherryMessagePart } from '@shared/data/types/message'

import { buildAgentSessionTopicId } from '../../agentSession/topic'
import { agentChatContextProvider } from '../context/AgentChatContextProvider'
import type { StreamListener } from '../types'

/**
 * Start (or inject into) an agent-session stream from a non-renderer caller.
 *
 * Encapsulates the user/assistant persistence + driver turn-begin done by
 * `AgentChatContextProvider`, so schedulers, channel inbound handlers, and
 * other backend triggers go through the same path as the renderer instead
 * of hand-rolling a `manager.send` call.
 *
 * The first listener is treated as the primary subscriber (gets the
 * `runtime.listeners` augmentation from the context provider); any
 * additional listeners are appended verbatim.
 *
 * Lives alongside `dispatch.ts` because stream-manager already owns the
 * downward dependency on agent-session (`AgentChatContextProvider` imports
 * ai/runtime + agent-session/topic). Putting this facade here
 * keeps the direction one-way; if it lived in agent-session/ the package
 * graph would loop back through stream-manager/context.
 */
export async function startAgentSessionRun(input: {
  sessionId: string
  userParts: CherryMessagePart[]
  listeners: StreamListener[]
  headless?: boolean
}): Promise<void> {
  if (input.listeners.length === 0) {
    throw new Error('startAgentSessionRun requires at least one listener')
  }
  const [primary, ...extras] = input.listeners

  const topicId = buildAgentSessionTopicId(input.sessionId)
  const manager = application.get('AiStreamManager')

  // Hold the per-topic dispatch lock around the whole `hasLiveStream → prepareDispatch
  // (writes a PENDING placeholder) → send` window, the same as the renderer's `dispatch()`.
  // Two backend triggers (scheduled tasks, channel inbound) can fire on one session topic
  // concurrently — or race a renderer open — and without this both could observe no live
  // stream and each write a placeholder, orphaning one as a permanently "thinking" row.
  await manager.withDispatchLock(topicId, async () => {
    // Write-quiesce admission gate (backup restore), re-checked under the lock and BEFORE
    // `prepareDispatch` writes the user/pending-assistant rows. Both callers handle the
    // rejection: an `agent.task` job settles failed-retryable; channel inbound notifies the
    // user — and per the restore orchestration order, channel batches are flushed and
    // admitted before the AI pause, so this throw only fires for out-of-order callers.
    if (manager.isWriteQuiesced) {
      throw new Error(
        'AiStreamManager is write-quiesced (backup restore in progress); refusing a new agent-session turn'
      )
    }
    const prepared = await agentChatContextProvider.prepareDispatch(primary, {
      trigger: 'submit-message',
      topicId,
      userMessageParts: input.userParts,
      headless: input.headless === true
    })

    manager.send({
      topicId: prepared.topicId,
      models: prepared.models,
      listeners: [...prepared.listeners, ...extras],
      siblingsGroupId: prepared.siblingsGroupId,
      lifecycle: prepared.lifecycle
    })
  })
}
