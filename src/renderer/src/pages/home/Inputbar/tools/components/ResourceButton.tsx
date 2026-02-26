import { ActionIconButton } from '@renderer/components/Buttons'
import type { ToolQuickPanelApi, ToolQuickPanelController } from '@renderer/pages/home/Inputbar/types'
import type { InstalledPlugin } from '@renderer/types/plugin'
import { Tooltip } from 'antd'
import { FolderOpen } from 'lucide-react'
import type { FC } from 'react'
import type React from 'react'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'

import { useResourcePanel } from './useResourcePanel'

interface Props {
  quickPanel: ToolQuickPanelApi
  quickPanelController: ToolQuickPanelController
  accessiblePaths: string[]
  plugins: InstalledPlugin[]
  pluginsLoading: boolean
  setText: React.Dispatch<React.SetStateAction<string>>
}

const ResourceButton: FC<Props> = ({
  quickPanel,
  quickPanelController,
  accessiblePaths,
  plugins,
  pluginsLoading,
  setText
}) => {
  const { t } = useTranslation()

  const { handleOpenQuickPanel } = useResourcePanel(
    {
      quickPanel,
      quickPanelController,
      accessiblePaths,
      plugins,
      pluginsLoading,
      setText
    },
    'button'
  )

  return (
    <Tooltip placement="top" title={t('chat.input.resource_panel.title')} mouseLeaveDelay={0} arrow>
      <ActionIconButton onClick={handleOpenQuickPanel} aria-label={t('chat.input.resource_panel.title')}>
        <FolderOpen size={18} />
      </ActionIconButton>
    </Tooltip>
  )
}

export default memo(ResourceButton)
