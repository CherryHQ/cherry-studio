import type { ToolActionKey, ToolRenderContext, ToolStateKey } from '@renderer/pages/home/Inputbar/types'
import type { FileType, Model } from '@renderer/types'
import type React from 'react'

import { useMentionModelsPanel } from './useMentionModelsPanel'

interface ManagerProps {
  context: ToolRenderContext<readonly ToolStateKey[], readonly ToolActionKey[]>
}

const MentionModelsQuickPanelManager = ({ context }: ManagerProps) => {
  const {
    quickPanel,
    state: { mentionedModels, files, couldMentionNotVisionModel },
    actions: { setMentionedModels, onTextChange }
  } = context

  useMentionModelsPanel(
    {
      quickPanel,
      mentionedModels: mentionedModels as Model[],
      setMentionedModels: setMentionedModels as React.Dispatch<React.SetStateAction<Model[]>>,
      couldMentionNotVisionModel,
      files: files as FileType[],
      setText: onTextChange as React.Dispatch<React.SetStateAction<string>>
    },
    'manager'
  )

  return null
}

export default MentionModelsQuickPanelManager
