import { loggerService } from '@logger'

const logger = loggerService.withContext('popupMessage')

export interface PopupMessageListenerOptions<T> {
  /** The popup the payload is expected from. `event.source` must match it. */
  popup: Window | null
  /**
   * Non-throwing shape guard: returns whether the event data carries the
   * expected payload. Called for every message event, so it must tolerate
   * `null`, plain strings and unrelated objects.
   */
  isExpected: (data: unknown) => data is T
  /** Invoked exactly once per flow, only for events passing `isExpected`. */
  onMessage: (data: T) => void | Promise<void>
}

/**
 * Listen for a single postMessage from an OAuth popup with exact-reference
 * cleanup on every exit path (#19210).
 *
 * The previous flow shapes removed the listener only on success, registered a
 * fresh closure that a no-op pre-add `removeEventListener` could never match,
 * and dereferenced `event.data` unguarded — a message with `null` data threw
 * inside the handler. Listeners from cancelled, closed or failing popups
 * accumulated forever, and a later flow's message could still reach a stale
 * handler's `setKey`.
 *
 * This helper:
 *  - keeps one stable handler reference and one `cleanup()` for success,
 *    failure, popup-closed and popup-blocked paths alike;
 *  - ignores events whose `source` is not the popup we opened;
 *  - never throws from the handler itself (errors in `onMessage` are logged
 *    and reported through `onError`, then the listener is removed);
 *  - polls `popup.closed` so a user-closed popup still tears the listener down.
 *
 * @returns the cleanup function (idempotent).
 */
export function listenForPopupMessage<T>(options: PopupMessageListenerOptions<T>): () => void {
  const { popup, isExpected, onMessage } = options

  let timer: ReturnType<typeof setInterval> | null = null
  let removed = false

  const cleanup = (): void => {
    if (removed) return
    removed = true
    if (timer !== null) {
      clearInterval(timer)
      timer = null
    }
    window.removeEventListener('message', handler)
  }

  const handler = async (event: MessageEvent): Promise<void> => {
    // Constrain to the popup we opened: any other frame or window posting a
    // same-shaped payload must not complete (or corrupt) this flow.
    if (popup && event.source !== popup) return
    if (!isExpected(event.data)) return

    cleanup()
    try {
      await onMessage(event.data)
    } catch (error) {
      logger.error('popup message handler failed', error as Error)
    }
  }

  window.addEventListener('message', handler)

  // A blocked popup (window.open returning null or an already-closed window)
  // can never deliver the payload — do not leave the listener armed.
  if (!popup || popup.closed) {
    cleanup()
    return cleanup
  }

  timer = setInterval(() => {
    if (popup.closed) cleanup()
  }, 1000)

  return cleanup
}
