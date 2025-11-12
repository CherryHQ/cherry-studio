import { ActionIconButton } from '@renderer/components/Buttons'
import type { ToolQuickPanelApi, ToolQuickPanelController } from '@renderer/pages/home/Inputbar/types'
import { Tooltip } from 'antd'
import { FolderOpen } from 'lucide-react'
import type { FC } from 'react'
import type React from 'react'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'

import { useActivityDirectoryPanel } from './useActivityDirectoryPanel'

interface Props {
  quickPanel: ToolQuickPanelApi
  quickPanelController: ToolQuickPanelController
  accessiblePaths: string[]
  setText: React.Dispatch<React.SetStateAction<string>>
}

const ActivityDirectoryButton: FC<Props> = ({ quickPanel, quickPanelController, accessiblePaths, setText }) => {
  const { t } = useTranslation()

  const { handleOpenQuickPanel } = useActivityDirectoryPanel(
    {
      quickPanel,
      quickPanelController,
      accessiblePaths,
      setText
    },
    'button'
  )

  return (
    <Tooltip placement="top" title={t('chat.input.activity_directory.title')} mouseLeaveDelay={0} arrow>
      <ActionIconButton onClick={handleOpenQuickPanel} icon={<FolderOpen size={18} />}></ActionIconButton>
    </Tooltip>
  )
}

export default memo(ActivityDirectoryButton)
