import { TopicType } from '@renderer/types/topic'

import type { ComposerToolScope, ComposerToolScopeConfig } from './types'

const DEFAULT_COMPOSER_TOOL_SCOPE: ComposerToolScope = TopicType.Chat

const composerToolConfigRegistry: Partial<Record<ComposerToolScope, ComposerToolScopeConfig>> = {
  [TopicType.Chat]: {
    enableQuickPanel: true,
    enableDragDrop: true
  },
  [TopicType.Session]: {
    enableQuickPanel: true,
    enableDragDrop: true
  },
  'quick-assistant': {
    enableQuickPanel: true,
    enableDragDrop: false,
    inheritedToolScopes: [TopicType.Chat],
    // The chat placeholder documents three affordances and truncates in a 680px bar.
    placeholderKey: 'quickAssistant.input.placeholder.empty'
  },
  // Image-generation prompt bar: the slash quick panel surfaces only the saved
  // prompts library (the sole root-panel launcher in this scope), plus drag-drop
  // of input images (the drop layer filters by supportedExts; the edit-only
  // constraint is enforced via couldAddImageFile / switchModel, not here).
  painting: {
    enableQuickPanel: true,
    enableDragDrop: true
  }
}

export const getComposerToolConfig = (scope: ComposerToolScope): ComposerToolScopeConfig => {
  return composerToolConfigRegistry[scope] ?? composerToolConfigRegistry[DEFAULT_COMPOSER_TOOL_SCOPE]!
}

export const isComposerToolVisibleInScope = (
  visibleInScopes: readonly ComposerToolScope[] | undefined,
  scope: ComposerToolScope
): boolean => {
  if (!visibleInScopes) return true

  const inheritedToolScopes = getComposerToolConfig(scope).inheritedToolScopes ?? []
  return [scope, ...inheritedToolScopes].some((candidate) => visibleInScopes.includes(candidate))
}
