import { useAppSelector } from '@renderer/store'

/**
 * Per-card streaming signal source (P1-S2d, item 3).
 *
 * Returns the live `loadingByTopic` map from the messages slice. A branch card
 * is "streaming" when `map[branch.topic.id]` is true.
 *
 * Why this flag and NOT `message.status`: `loadingByTopic[topicId]` is set true
 * at the stream task's start and cleared ONLY after that topic's request queue
 * fully drains (`finishTopicLoading` → `await waitForTopicQueue`) — i.e. the
 * SAME real-completion boundary that emits `MESSAGE_COMPLETE` (the one
 * `scheduleForkTopicDeletion` already waits on). It therefore stays true across
 * the whole "first block done → real stream end" window, whereas the B6 defect
 * flips `message.status` to `success` prematurely. Each branch owns a distinct
 * fork topic, so keying by `topic.id` isolates loading per card automatically.
 *
 * Read-only: this only subscribes to the existing slice; it never mutates Redux
 * state or its shape.
 */
export function useLoadingByTopic(): Record<string, boolean> {
  return useAppSelector((state) => state.messages.loadingByTopic)
}
