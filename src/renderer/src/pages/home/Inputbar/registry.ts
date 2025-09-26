import { TopicType } from '@renderer/types'

import { InputbarFeatures, InputbarScope, InputbarScopeConfig } from './types'

const DEFAULT_INPUTBAR_SCOPE: InputbarScope = TopicType.Chat

const inputbarRegistry = new Map<InputbarScope, InputbarScopeConfig>([
  [
    TopicType.Chat,
    {
      features: {
        enableAttachments: true,
        enableKnowledge: true,
        enableMentionModels: true,
        enableTranslate: true,
        enableWebSearch: true,
        enableMCPTools: true,
        enableGenImage: true,
        enableThinking: true,
        enableUrlContext: true,
        enableQuickPhrases: true,
        enableNewTopic: true,
        enableClearTopic: true,
        enableExpand: true,
        enableNewContext: true,
        enableSendButton: true,
        enableAbortButton: true
      },
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
      features: {
        enableAttachments: false,
        enableKnowledge: false,
        enableMentionModels: false,
        enableTranslate: false,
        enableWebSearch: false,
        enableMCPTools: false,
        enableGenImage: false,
        enableThinking: false,
        enableUrlContext: false,
        enableQuickPhrases: false,
        enableNewTopic: false,
        enableClearTopic: false,
        enableExpand: false,
        enableNewContext: false,
        enableSendButton: true,
        enableAbortButton: true
      },
      placeholder: 'Type a message...',
      minRows: 1,
      maxRows: 4,
      showTokenCount: false,
      showTools: false,
      toolsCollapsible: false,
      enableQuickPanel: false,
      enableDragDrop: false
    }
  ],
  [
    'mini-window',
    {
      features: {
        enableAttachments: true,
        enableKnowledge: false,
        enableMentionModels: true,
        enableTranslate: true,
        enableWebSearch: false,
        enableMCPTools: false,
        enableGenImage: false,
        enableThinking: false,
        enableUrlContext: false,
        enableQuickPhrases: true,
        enableNewTopic: false,
        enableClearTopic: false,
        enableExpand: false,
        enableNewContext: false,
        enableSendButton: true,
        enableAbortButton: true
      },
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

export const getInputbarFeatures = (scope: InputbarScope): InputbarFeatures => {
  return getInputbarConfig(scope).features
}
