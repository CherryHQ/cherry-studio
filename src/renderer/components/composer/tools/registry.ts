import { TopicType } from '@renderer/types'

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
    enableDragDrop: false
  },
  // Image-generation prompt bar: the slash quick panel surfaces only the saved
  // prompts library (the sole root-panel launcher in this scope), plus drag-drop
  // of input images for edit-image models.
  painting: {
    enableQuickPanel: true,
    enableDragDrop: true
  }
}

export const getComposerToolConfig = (scope: ComposerToolScope): ComposerToolScopeConfig => {
  return composerToolConfigRegistry[scope] ?? composerToolConfigRegistry[DEFAULT_COMPOSER_TOOL_SCOPE]!
}
