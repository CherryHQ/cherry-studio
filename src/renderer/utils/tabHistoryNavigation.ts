import type { RouterHistory } from '@tanstack/react-router'

/**
 * Memory history exposes canGoBack but not canGoForward. Forward is available
 * when the current __TSR_index still has entries after it.
 */
export const canGoForward = (history: Pick<RouterHistory, 'length' | 'location'>): boolean => {
  const index = history.location.state.__TSR_index
  return typeof index === 'number' && index < history.length - 1
}

export const goTabHistoryBack = (history: Pick<RouterHistory, 'back' | 'canGoBack'>): boolean => {
  if (!history.canGoBack()) return false
  history.back()
  return true
}

export const goTabHistoryForward = (history: Pick<RouterHistory, 'forward' | 'length' | 'location'>): boolean => {
  if (!canGoForward(history)) return false
  history.forward()
  return true
}
