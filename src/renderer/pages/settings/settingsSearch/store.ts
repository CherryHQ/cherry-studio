/**
 * Module-level store sharing keyboard selection and jump intents between the
 * sidebar search box (settings layout) and the results page (child route).
 * Shared across all tabs of one window: safety relies on React <Activity>
 * unmounting the hidden tab's effects (jump handler unregisters, results
 * republish on reactivation).
 */
import { useSyncExternalStore } from 'react'

export interface SettingsSearchKeyboardState {
  activeIndex: number
  resultCount: number
  /** DOM id the next navigation should scroll to and flash; consumed by SettingsFocusScroll */
  pendingFocusId: string | undefined
  /**
   * Query as currently typed (immediate, pre-debounce). The box writes it on
   * every keystroke; the results page ranks against it so Enter never jumps on
   * stale results while the debounced URL mirror is still in flight. undefined
   * means "box has not spoken yet" — consumers fall back to the URL value.
   */
  liveQuery: string | undefined
}

let state: SettingsSearchKeyboardState = {
  activeIndex: 0,
  resultCount: 0,
  pendingFocusId: undefined,
  liveQuery: undefined
}

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

/** Search box reports the query as typed (pre-debounce mirror into the URL);
 * passing undefined releases ownership (tab hidden/unmounted) — the store is
 * window-global, so a hidden tab must not leave its query stuck in it */
export function setLiveQuery(query: string | undefined) {
  setState({ liveQuery: query })
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

/** DOM ids shared by the combobox input (aria-controls/activedescendant) and the listbox */
export const SETTINGS_SEARCH_LISTBOX_ID = 'settings-search-results-listbox'

export const settingsSearchOptionDomId = (index: number) => `settings-search-option-${index}`
