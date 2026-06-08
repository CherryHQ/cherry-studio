import type { ToolActionKey, ToolRenderContext, ToolStateKey } from '@renderer/pages/home/Inputbar/types'
import type React from 'react'

import { useMentionModelsPanel } from './useMentionModelsPanel'

interface ManagerProps {
  context: ToolRenderContext<readonly ToolStateKey[], readonly ToolActionKey[]>
}

const MentionModelsQuickPanelManager = ({ context }: ManagerProps) => {
  const {
    quickPanel,
    quickPanelController,
    state: { mentionedModels, mentionedAssistant, files, couldMentionNotVisionModel },
    actions: { setMentionedModels, setMentionedAssistant, onTextChange }
  } = context

  useMentionModelsPanel(
    {
      quickPanel,
      quickPanelController,
      mentionedModels: mentionedModels,
      setMentionedModels: setMentionedModels,
      mentionedAssistant: mentionedAssistant,
      setMentionedAssistant: setMentionedAssistant,
      couldMentionNotVisionModel,
      files: files,
      setText: onTextChange as React.Dispatch<React.SetStateAction<string>>
    },
    'manager'
  )

  return null
}

export default MentionModelsQuickPanelManager
