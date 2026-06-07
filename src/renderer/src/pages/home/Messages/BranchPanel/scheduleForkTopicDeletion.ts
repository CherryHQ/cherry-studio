import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'

/** Backstop: delete anyway if the settle event never arrives (never leak an
 *  orphan). A few seconds — comfortably longer than a normal finalize PATCH. */
const DEFAULT_SETTLE_TIMEOUT_MS = 8000

interface MessageCompletePayload {
  id?: string
  topicId?: string
  status?: string
}

/**
 * Decide WHEN to delete a pending branch's fork topic on close (P1-S3
 * delete-after-settle):
 *
 *   - NON-streaming (`awaitedMessageIds` empty): delete immediately — there is
 *     no in-flight finalize to race.
 *   - STREAMING: the close already aborted the in-flight reply, whose
 *     `streamingService.finalize` then PATCHes `/messages/:id` asynchronously.
 *     Deleting now races that PATCH → 404 (+ an unhandled rejection). Instead,
 *     wait for the existing `MESSAGE_COMPLETE` event (emitted AFTER finalize's
 *     PATCH lands) for THIS topic's aborted message(s), then delete. A timeout
 *     is the backstop so an orphan is never leaked.
 *
 * App-level only — listens on the existing EventEmitter; nothing in the
 * streaming/abort internals is touched.
 *
 * @returns a cleanup fn (removes the listener + clears the timer). It also runs
 *          automatically once the delete fires.
 */
export function scheduleForkTopicDeletion(
  topicId: string,
  awaitedMessageIds: string[],
  deleteTopic: (topicId: string) => void,
  timeoutMs: number = DEFAULT_SETTLE_TIMEOUT_MS
): () => void {
  // Non-streaming → no race → delete now.
  if (awaitedMessageIds.length === 0) {
    deleteTopic(topicId)
    return () => {}
  }

  const remaining = new Set(awaitedMessageIds)
  // Mutable holders so the callbacks below can reference the listener + timer
  // lazily (they're created after the callbacks are defined).
  const handles: { unsubscribe: () => void; timer?: ReturnType<typeof setTimeout> } = { unsubscribe: () => {} }
  let settled = false

  const cleanup = () => {
    handles.unsubscribe()
    if (handles.timer !== undefined) clearTimeout(handles.timer)
  }

  const finish = () => {
    if (settled) return
    settled = true
    cleanup()
    deleteTopic(topicId)
  }

  // MESSAGE_COMPLETE fires app-wide (incl. the main chat) AFTER each message's
  // finalize PATCH lands — match THIS topic's aborted message(s) only.
  const onMessageComplete = (payload: MessageCompletePayload) => {
    if (!payload || payload.topicId !== topicId) return
    if (payload.id) remaining.delete(payload.id)
    if (remaining.size === 0) finish()
  }

  handles.unsubscribe = EventEmitter.on(EVENT_NAMES.MESSAGE_COMPLETE, onMessageComplete as (payload: unknown) => void)
  handles.timer = setTimeout(finish, timeoutMs)

  return cleanup
}
