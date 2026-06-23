export const CHAT_SHELL_PANE_WIDTH = 'var(--assistants-width)'
export const CHAT_CENTER_MIN_USABLE_WIDTH = 360
export const CHAT_SHELL_TRANSITION = {
  duration: 0.3,
  ease: 'easeInOut'
} as const

export type ChatPanePosition = 'left' | 'right'

export const RESOURCE_LIST_PANE_DEFAULT_WIDTH = 240
export const RESOURCE_LIST_PANE_MIN_WIDTH = 240
export const RESOURCE_LIST_PANE_MAX_WIDTH = 360
export const RESOURCE_LIST_PANE_COLLAPSE_DRAG_THRESHOLD = 200
export const RESOURCE_LIST_PANE_AUTO_COLLAPSE_WIDTH = 540
export const RESOURCE_LIST_PANE_CACHE_KEY = 'ui.chat.sidebar.width'

export const ARTIFACT_RIGHT_PANE_MIN_WIDTH = 360
export const ARTIFACT_RIGHT_PANE_DEFAULT_WIDTH = 460
export const ARTIFACT_RIGHT_PANE_MAX_WIDTH = 720
export const ARTIFACT_RIGHT_PANE_CACHE_KEY = 'ui.chat.artifact_pane.width'
