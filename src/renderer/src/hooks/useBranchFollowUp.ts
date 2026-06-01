import { getUserMessage } from '@renderer/services/MessagesService'
import { useAppDispatch } from '@renderer/store'
import { sendMessage as sendMessageThunk } from '@renderer/store/thunk/messageThunk'
import type { Assistant, Topic } from '@renderer/types'
import { useCallback } from 'react'

interface UseBranchFollowUpArgs {
  /** The assistant currently in use on the source topic (same one fork used). */
  assistant: Assistant
}

interface UseBranchFollowUpResult {
  /**
   * Append a follow-up turn to an ALREADY-established branch topic.
   *
   * Pure reuse of the existing `sendMessage` thunk — no POST /topics (the
   * branch topic already exists, created by `useBranchFork`), and no change to
   * streaming / messageThunk internals. We only call the public thunk with the
   * correct branch `topic.id` plus a synthetic assistant.
   */
  send: (branchTopic: Topic, followUp: string) => void
}

/**
 * useBranchFollowUp — P1-S2b-2 per-card follow-up send.
 *
 * `useBranchFork` handles the FIRST turn (it creates the topic and sends the
 * opening message). This hook handles every SUBSEQUENT turn typed into an open
 * branch card's conversation-state composer. It shares the exact send path:
 *
 *   getUserMessage(...) → dispatch(sendMessage(message, blocks, assistant, topicId))
 *
 * Two non-obvious requirements, both inherited from `useBranchFork`:
 *
 *  1. **Target topic id.** `dispatch(sendMessage(..., branchTopic.id))` routes
 *     the user message + streamed reply into THIS branch's topic. With N
 *     branches open the caller must pass the card's own branch topic — routing
 *     correctness lives at the call site (Chat.tsx resolves branchId → topic).
 *
 *  2. **Synthetic assistant carrying the branch topic + its prompt.**
 *     `messageThunk.ts:853` rebuilds the system prompt on EVERY send via
 *     `origAssistant.topics.find(t => t.id === topicId)?.prompt`. The branch
 *     topic carries the hidden Mode-A system prompt (selectedText + main goal)
 *     in `topic.prompt`. If we sent the plain Redux assistant (whose `.topics`
 *     never contains the branch topic — it's kept out of the sidebar), the
 *     follow-up turn would lose that context and the model would go blind on
 *     turn 2. So we rebuild the same `{ ...assistant, topics: [...topics,
 *     branchTopic] }` synthetic that fork builds.
 *
 * The branch subtree is NOT dispatched into Redux `assistants[].topics`
 * (sidebar stays clean) — exactly mirroring useBranchFork.
 */
export function useBranchFollowUp({ assistant }: UseBranchFollowUpArgs): UseBranchFollowUpResult {
  const dispatch = useAppDispatch()

  const send = useCallback(
    (branchTopic: Topic, followUp: string) => {
      const trimmed = followUp.trim()
      if (!trimmed) return

      // Synthetic assistant: same id as the main assistant, `.topics`
      // transiently carries the branch topic (with `prompt` set at fork time)
      // so messageThunk:853 re-injects the hidden system prompt on this turn.
      const assistantWithBranch: Assistant = {
        ...assistant,
        topics: [...assistant.topics, branchTopic]
      }

      const { message, blocks } = getUserMessage({
        assistant: assistantWithBranch,
        topic: branchTopic,
        content: trimmed
      })

      void dispatch(sendMessageThunk(message, blocks, assistantWithBranch, branchTopic.id))
    },
    [assistant, dispatch]
  )

  return { send }
}
