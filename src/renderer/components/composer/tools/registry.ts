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
    enableDragDrop: false
  },
  // Unified Creation prompt bar (image + video modes): the slash quick panel
  // surfaces only the saved prompts library (the sole root-panel launcher in
  // this scope), plus drag-drop of input images (the drop layer filters by
  // supportedExts; image's edit-only constraint is enforced via
  // couldAddImageFile / switchModel, and video opts out of the flat attachment
  // pipeline entirely — see attachmentTool's condition).
  creation: {
    enableQuickPanel: true,
    enableDragDrop: true
  }
}

export const getComposerToolConfig = (scope: ComposerToolScope): ComposerToolScopeConfig => {
  return composerToolConfigRegistry[scope] ?? composerToolConfigRegistry[DEFAULT_COMPOSER_TOOL_SCOPE]!
}
