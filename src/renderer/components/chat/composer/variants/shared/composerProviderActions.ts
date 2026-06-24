import type { ComposerSurfaceActions } from '@renderer/components/chat/composer/ComposerSurface'

/**
 * Payload for "start a new topic" from the composer. Owned here (composer layer)
 * rather than `pages/home/types` so the composer doesn't import upward into pages;
 * `pages/home/types` re-exports it for page-side consumers.
 */
export interface AddNewTopicPayload {
  assistantId?: string | null
}

/**
 * The imperative action surface both composer variants expose through their
 * provider `actionsRef`. Shared so the chat/agent variants can't drift (the
 * `addNewTopic` signature previously diverged between the two files).
 */
export type ProviderActionHandlers = ComposerSurfaceActions & {
  addNewTopic: (payload?: AddNewTopicPayload) => void
}

export const emptyActions: ProviderActionHandlers = {
  addNewTopic: () => undefined,
  focus: () => undefined,
  onTextChange: () => undefined,
  toggleExpanded: () => undefined,
  removeToken: () => undefined,
  insertToken: () => undefined,
  getDraft: () => ({ text: '', tokens: [] })
}
