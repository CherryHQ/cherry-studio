import store from '@renderer/store'
import { selectMessagesForTopic } from '@renderer/store/newMessage'
import { abortCompletion, abortMap } from '@renderer/utils/abortController'

/**
 * Abort any in-flight (streaming) assistant response on a branch's forked
 * topic (P1-B5), scoped to ONE topic. Targets the topic's assistant messages
 * whose `askId` (the registered abort key) is still present in `abortMap`, and
 * calls the EXISTING `abortCompletion` for each.
 *
 * Why abortMap presence and NOT message status: the message status can already
 * be 'success' in Redux while the underlying stream is still open (the
 * block-complete reducer flips PROCESSING→SUCCESS before the stream truly ends —
 * upstream issue "B"). A `status === processing|pending` filter therefore
 * silently misses that still-streaming reply and never cancels it. The live
 * abortController is the reliable signal. Reuses the existing abort path only —
 * no StreamingService / messageThunk internal changes.
 *
 * Called by Chat.tsx's branch close handler BEFORE the branch is removed from
 * state, so the in-flight stream is stopped instead of running to completion.
 *
 * @returns the ids of the assistant messages it aborted — P1-S3
 *   delete-after-settle waits for THESE to fire `MESSAGE_COMPLETE` (their
 *   finalize PATCH lands) before deleting the fork topic. Empty = nothing live.
 */
export function abortBranchTopicStream(topicId: string): string[] {
  const messages = selectMessagesForTopic(store.getState(), topicId)
  if (!messages?.length) return []

  // P1-S3 fix (direction A): pick abort targets by LIVE abort controller, NOT by
  // message status. A branch reply can already be status:'success' in Redux while its
  // HTTP stream to the backend is still open — the block-complete reducer flips the
  // MESSAGE to SUCCESS before the stream truly ends (upstream issue "B", see
  // 问题与Debug记录). Its abortController is still registered in abortMap, so a
  // status filter (processing|pending) silently misses exactly that case and the stream
  // is never cancelled. Abort by abortMap presence instead; abortCompletion on an
  // already-settled controller is a harmless, idempotent no-op (and incidentally
  // garbage-collects the leaked map entry).
  const aborted = messages.filter((m) => m.role === 'assistant' && !!m.askId && abortMap.has(m.askId))
  const askIds = [...new Set(aborted.map((m) => m.askId as string))]

  for (const askId of askIds) {
    abortCompletion(askId)
  }

  return aborted.map((m) => m.id)
}
