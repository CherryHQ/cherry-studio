import { ActionIconButton } from '@renderer/components/Buttons'
import type { ToolQuickPanelApi, ToolQuickPanelController } from '@renderer/pages/home/Inputbar/types'
import type { Assistant, FileMetadata } from '@renderer/types'
import type { Model } from '@shared/data/types/model'
import { Tooltip } from 'antd'
import { AtSign } from 'lucide-react'
import type { FC } from 'react'
import type React from 'react'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'

import { useMentionModelsPanel } from './useMentionModelsPanel'

interface Props {
  quickPanel: ToolQuickPanelApi
  quickPanelController: ToolQuickPanelController
  mentionedModels: Model[]
  setMentionedModels: React.Dispatch<React.SetStateAction<Model[]>>
  mentionedAssistant: Assistant | null
  setMentionedAssistant: React.Dispatch<React.SetStateAction<Assistant | null>>
  couldMentionNotVisionModel: boolean
  files: FileMetadata[]
  setText: React.Dispatch<React.SetStateAction<string>>
}

const MentionModelsButton: FC<Props> = ({
  quickPanel,
  quickPanelController,
  mentionedModels,
  setMentionedModels,
  mentionedAssistant,
  setMentionedAssistant,
  couldMentionNotVisionModel,
  files,
  setText
}) => {
  const { t } = useTranslation()

  const { handleOpenQuickPanel } = useMentionModelsPanel(
    {
      quickPanel,
      quickPanelController,
      mentionedModels,
      setMentionedModels,
      mentionedAssistant,
      setMentionedAssistant,
      couldMentionNotVisionModel,
      files,
      setText
    },
    'button'
  )

  return (
    <Tooltip placement="top" title={t('assistants.presets.edit.model.select.title')} mouseLeaveDelay={0} arrow>
      <ActionIconButton
        onClick={handleOpenQuickPanel}
        active={mentionedModels.length > 0}
        aria-label={t('assistants.presets.edit.model.select.title')}
        icon={<AtSign size={18} />}></ActionIconButton>
    </Tooltip>
  )
}

export default memo(MentionModelsButton)
