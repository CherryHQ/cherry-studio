import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { ResourceListRevealPayload } from '@renderer/types/resourceCatalog'

export function emitResourceListReveal(payload: ResourceListRevealPayload) {
  const emit = () => {
    void EventEmitter.emit(EVENT_NAMES.REVEAL_ACTIVE_RESOURCE_LIST, payload)
  }

  if (typeof window === 'undefined') {
    emit()

    return
  }

  if (window.requestAnimationFrame) {
    window.requestAnimationFrame(emit)

    return
  }

  window.setTimeout(emit, 0)
}
