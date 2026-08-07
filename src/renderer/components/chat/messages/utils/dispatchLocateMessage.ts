import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'

import type { MessageListRuntime } from '../types'

// A smooth in-list navigation runs for dozens of frames and virtua only mounts
// the destination as the viewport approaches it, so the locate subscriber (the
// target's MessageGroup / MessageFrame) may not exist yet when the scroll
// starts. Waiting a bounded number of frames covers the longest smooth
// navigation plus the mount, without leaving a dangling loop when the target
// never materializes (deleted message, topic switched away).
const LOCATE_SUBSCRIBER_WAIT_FRAMES = 120

/**
 * Scroll the virtualized list to `messageId`'s group, then deliver the locate
 * event (sibling selection + highlight) once its subscriber is mounted.
 * Without a runtime the event is emitted immediately for non-virtualized hosts.
 */
export function dispatchLocateMessage(
  runtime: MessageListRuntime | null,
  messageId: string,
  highlight?: boolean
): void {
  const eventName = EVENT_NAMES.LOCATE_MESSAGE + ':' + messageId
  if (!runtime) {
    void EventEmitter.emit(eventName, highlight)
    return
  }

  runtime.locateMessage(messageId)
  let remainingFrames = LOCATE_SUBSCRIBER_WAIT_FRAMES
  const deliver = (): void => {
    if (EventEmitter.listenerCount(eventName) > 0) {
      void EventEmitter.emit(eventName, highlight)
      return
    }
    remainingFrames -= 1
    if (remainingFrames <= 0) return
    requestAnimationFrame(deliver)
  }
  requestAnimationFrame(deliver)
}
