/**
 * Module-level store sharing keyboard selection and jump intents between the
 * sidebar search box (settings layout) and the results page (child route).
 * Tab-scoped by construction: every tab keeps its own renderer instance.
 */
import { useSyncExternalStore } from 'react'

export interface SettingsSearchKeyboardState {
  activeIndex: number
  resultCount: number
  /** DOM id the next navigation should scroll to and flash; consumed by SettingsFocusScroll */
  pendingFocusId: string | undefined
}

let state: SettingsSearchKeyboardState = { activeIndex: 0, resultCount: 0, pendingFocusId: undefined }

const listeners = new Set<() => void>()

function setState(patch: Partial<SettingsSearchKeyboardState>) {
  state = { ...state, ...patch }
  for (const listener of listeners) listener()
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const getSnapshot = () => state

export function useSettingsSearchKeyboard(): SettingsSearchKeyboardState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/** Results page reports the fresh result list; selection resets to the first row */
export function publishResults(count: number) {
  setState({ resultCount: count, activeIndex: 0 })
}

export function moveActiveIndex(direction: 1 | -1) {
  if (state.resultCount === 0) return
  const next = (state.activeIndex + direction + state.resultCount) % state.resultCount
  setState({ activeIndex: next })
}

let jumpToIndex: ((index: number) => void) | undefined

/** Results page registers the jump executor (owns navigation); returns unregister */
export function registerJumpHandler(handler: (index: number) => void) {
  jumpToIndex = handler
  return () => {
    if (jumpToIndex === handler) jumpToIndex = undefined
  }
}

/** Search box Enter key requests a jump to the currently selected result */
export function requestJump() {
  jumpToIndex?.(state.activeIndex)
}

export function setPendingFocus(domId: string | undefined) {
  setState({ pendingFocusId: domId })
}
