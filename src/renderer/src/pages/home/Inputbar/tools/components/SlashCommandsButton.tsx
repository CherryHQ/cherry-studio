import { ActionIconButton } from '@renderer/components/Buttons'
import { QuickPanelReservedSymbol } from '@renderer/components/QuickPanel'
import type { ToolContext, ToolQuickPanelController } from '@renderer/pages/home/Inputbar/types'
import { Tooltip } from 'antd'
import { Terminal } from 'lucide-react'
import { type FC, type ReactElement, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  quickPanelController: ToolQuickPanelController
  session: ToolContext['session']
  openPanel: () => void
}

/**
 * SlashCommandsButton
 *
 * Simple button component that opens the SlashCommands panel (second level menu).
 * The openPanel handler is passed from the tool definition, keeping logic centralized.
 */
const SlashCommandsButton: FC<Props> = ({ quickPanelController, session, openPanel }): ReactElement => {
  const { t } = useTranslation()

  const slashCommands = useMemo(() => session?.slashCommands || [], [session?.slashCommands])

  const handleOpenQuickPanel = useCallback(() => {
    if (quickPanelController.isVisible && quickPanelController.symbol === QuickPanelReservedSymbol.SlashCommands) {
      quickPanelController.close()
    } else {
      openPanel()
    }
  }, [openPanel, quickPanelController])

  const hasCommands = slashCommands.length > 0
  const isActive =
    quickPanelController.isVisible && quickPanelController.symbol === QuickPanelReservedSymbol.SlashCommands

  return (
    <Tooltip placement="top" title={t('chat.input.slash_commands.title')} mouseLeaveDelay={0} arrow>
      <ActionIconButton
        onClick={handleOpenQuickPanel}
        active={isActive}
        disabled={!hasCommands}
        aria-label={t('chat.input.slash_commands.title')}>
        <Terminal size={18} />
      </ActionIconButton>
    </Tooltip>
  )
}

export default SlashCommandsButton
