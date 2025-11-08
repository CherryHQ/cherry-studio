import { TopicType } from '@renderer/types'

import type { InputbarScope, InputbarScopeConfig } from './types'

const DEFAULT_INPUTBAR_SCOPE: InputbarScope = TopicType.Chat

const inputbarRegistry = new Map<InputbarScope, InputbarScopeConfig>([
  [
    TopicType.Chat,
    {
      minRows: 1,
      maxRows: 8,
      showTokenCount: true,
      showTools: true,
      toolsCollapsible: true,
      enableQuickPanel: true,
      enableDragDrop: true
    }
  ],
  [
    TopicType.Session,
    {
      placeholder: 'Type a message...',
      minRows: 2,
      maxRows: 20,
      showTokenCount: false,
      showTools: true,
      toolsCollapsible: false,
      enableQuickPanel: true,
      enableDragDrop: true
    }
  ],
  [
    'mini-window',
    {
      minRows: 1,
      maxRows: 3,
      showTokenCount: false,
      showTools: true,
      toolsCollapsible: false,
      enableQuickPanel: true,
      enableDragDrop: false
    }
  ]
])

export const registerInputbarConfig = (scope: InputbarScope, config: InputbarScopeConfig): void => {
  inputbarRegistry.set(scope, config)
}

export const getInputbarConfig = (scope: InputbarScope): InputbarScopeConfig => {
  return inputbarRegistry.get(scope) || inputbarRegistry.get(DEFAULT_INPUTBAR_SCOPE)!
}
