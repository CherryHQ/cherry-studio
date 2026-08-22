export const CHAT_SHELL_PANE_WIDTH = 'var(--assistants-width)'
export const CHAT_CENTER_MIN_USABLE_WIDTH = 360
/** Hard floor for the center column once the right pane has yielded down to its minimum. */
export const CHAT_CENTER_FLOOR_WIDTH = 200
export const CHAT_SHELL_TRANSITION = {
  duration: 0.3,
  ease: 'easeInOut'
} as const

export type ChatPanePosition = 'left' | 'right'

export const RESOURCE_LIST_PANE_DEFAULT_WIDTH = 240
export const RESOURCE_LIST_PANE_MIN_WIDTH = 200
export const RESOURCE_LIST_PANE_MAX_WIDTH = 360
export const RESOURCE_LIST_PANE_COLLAPSE_DRAG_THRESHOLD = 200
export const RESOURCE_LIST_PANE_AUTO_COLLAPSE_WIDTH = 540
export const RESOURCE_LIST_PANE_CACHE_KEY = 'ui.chat.sidebar.width'

export const ARTIFACT_RIGHT_PANE_MIN_WIDTH = 255
export const ARTIFACT_RIGHT_PANE_CLOSE_DRAG_OVERSHOOT = 80
export const ARTIFACT_RIGHT_PANE_DEFAULT_WIDTH = 280
export const ARTIFACT_RIGHT_PANE_MAX_WIDTH = 720
export const ARTIFACT_RIGHT_PANE_CACHE_KEY = 'ui.chat.artifact_pane.width'

/**
 * The topic/session list borrows the right pane but is a list, not an artifact: it keeps the left
 * list's width envelope and its own persisted width, so dragging one never resizes the other.
 */
export const RESOURCE_LIST_RIGHT_PANE_CACHE_KEY = 'ui.chat.resource_pane.width'

export type RightPaneWidthProfile = {
  cacheKey: typeof ARTIFACT_RIGHT_PANE_CACHE_KEY | typeof RESOURCE_LIST_RIGHT_PANE_CACHE_KEY
  minWidth: number
  maxWidth: number
}

export const ARTIFACT_RIGHT_PANE_WIDTH_PROFILE = {
  cacheKey: ARTIFACT_RIGHT_PANE_CACHE_KEY,
  minWidth: ARTIFACT_RIGHT_PANE_MIN_WIDTH,
  maxWidth: ARTIFACT_RIGHT_PANE_MAX_WIDTH
} as const satisfies RightPaneWidthProfile

export const RESOURCE_LIST_RIGHT_PANE_WIDTH_PROFILE = {
  cacheKey: RESOURCE_LIST_RIGHT_PANE_CACHE_KEY,
  minWidth: RESOURCE_LIST_PANE_MIN_WIDTH,
  maxWidth: RESOURCE_LIST_PANE_MAX_WIDTH
} as const satisfies RightPaneWidthProfile
