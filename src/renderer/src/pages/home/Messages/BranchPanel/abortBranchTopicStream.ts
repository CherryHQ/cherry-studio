import store from '@renderer/store'
import { selectMessagesForTopic } from '@renderer/store/newMessage'
import { abortCompletion } from '@renderer/utils/abortController'

/**
 * Abort any in-flight (streaming) assistant response on a branch's forked
 * topic (P1-B5). Mirrors `useMessageOperations.pauseMessages`, scoped to ONE
 * topic: find that topic's processing/pending messages, collect their `askId`s
 * (the registered abort keys), and call the EXISTING `abortCompletion` for each.
 *
 * Reuses the existing abort path only — no StreamingService / messageThunk
 * internal changes. A non-streaming branch yields no askIds → no abort.
 *
 * Called by Chat.tsx's branch close handler BEFORE the branch is removed from
 * state, so the in-flight stream is stopped instead of running to completion.
 */
export function abortBranchTopicStream(topicId: string): void {
  const messages = selectMessagesForTopic(store.getState(), topicId)
  if (!messages?.length) return

  const askIds = [
    ...new Set(
      messages
        .filter((m) => m.status === 'processing' || m.status === 'pending')
        .map((m) => m.askId)
        .filter((id): id is string => !!id)
    )
  ]

  for (const askId of askIds) {
    abortCompletion(askId)
  }
}
