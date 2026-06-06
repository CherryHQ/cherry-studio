import { defineTool, registerTool, TopicType } from '@renderer/pages/home/Inputbar/types'
import type { Assistant } from '@renderer/types'
import type React from 'react'

import MentionModelsButton from './components/MentionModelsButton'
import MentionModelsQuickPanelManager from './components/MentionModelsQuickPanelManager'

/**
 * Mention Models Tool
 *
 * Allows users to mention multiple AI models in their messages.
 * Uses @ trigger to open model selection panel.
 */
const mentionModelsTool = defineTool({
  key: 'mention_models',
  label: (t) => t('assistants.presets.edit.model.select.title'),

  visibleInScopes: [TopicType.Chat, 'quick-assistant'],
  dependencies: {
    state: ['mentionedModels', 'mentionedAssistant', 'files', 'couldMentionNotVisionModel'] as const,
    actions: ['setMentionedModels', 'setMentionedAssistant', 'onTextChange'] as const
  },

  render: function MentionModelsToolRender(context) {
    const { state, actions, quickPanel, quickPanelController } = context
    const { mentionedModels, mentionedAssistant, files, couldMentionNotVisionModel } = state
    const { setMentionedModels, setMentionedAssistant, onTextChange } = actions

    return (
      <MentionModelsButton
        quickPanel={quickPanel}
        quickPanelController={quickPanelController}
        mentionedModels={mentionedModels}
        setMentionedModels={setMentionedModels}
        mentionedAssistant={mentionedAssistant}
        setMentionedAssistant={setMentionedAssistant as React.Dispatch<React.SetStateAction<Assistant | null>>}
        couldMentionNotVisionModel={couldMentionNotVisionModel}
        files={files}
        setText={onTextChange as React.Dispatch<React.SetStateAction<string>>}
      />
    )
  },
  quickPanelManager: MentionModelsQuickPanelManager
})

registerTool(mentionModelsTool)

export default mentionModelsTool
