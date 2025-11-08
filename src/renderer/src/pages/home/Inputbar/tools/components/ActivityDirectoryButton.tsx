import { ActionIconButton } from '@renderer/components/Buttons'
import type { ToolQuickPanelApi } from '@renderer/pages/home/Inputbar/types'
import { Tooltip } from 'antd'
import { FolderOpen } from 'lucide-react'
import type { FC } from 'react'
import type React from 'react'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'

import { useActivityDirectoryPanel } from './useActivityDirectoryPanel'

interface Props {
  quickPanel: ToolQuickPanelApi
  accessiblePaths: string[]
  setText: React.Dispatch<React.SetStateAction<string>>
}

const ActivityDirectoryButton: FC<Props> = ({ quickPanel, accessiblePaths, setText }) => {
  const { t } = useTranslation()

  const { handleOpenQuickPanel } = useActivityDirectoryPanel(
    {
      quickPanel,
      accessiblePaths,
      setText
    },
    'button'
  )

  return (
    <Tooltip placement="top" title={t('chat.input.activity_directory')} mouseLeaveDelay={0} arrow>
      <ActionIconButton onClick={handleOpenQuickPanel}>
        <FolderOpen size={18} />
      </ActionIconButton>
    </Tooltip>
  )
}

export default memo(ActivityDirectoryButton)
