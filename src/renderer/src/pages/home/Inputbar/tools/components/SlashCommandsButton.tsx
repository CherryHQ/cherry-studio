import { ActionIconButton } from '@renderer/components/Buttons'
import { QuickPanelReservedSymbol, useQuickPanel } from '@renderer/components/QuickPanel'
import type { ToolContext, ToolQuickPanelApi } from '@renderer/pages/home/Inputbar/types'
import { Tooltip } from 'antd'
import { Terminal } from 'lucide-react'
import { type FC, type ReactElement, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  quickPanel: ToolQuickPanelApi
  session: ToolContext['session']
  openPanel: () => void
}

/**
 * SlashCommandsButton
 *
 * Simple button component that opens the SlashCommands panel (second level menu).
 * The openPanel handler is passed from the tool definition, keeping logic centralized.
 */
const SlashCommandsButton: FC<Props> = ({ quickPanel, session, openPanel }): ReactElement => {
  const { t } = useTranslation()
  const quickPanelHook = useQuickPanel()

  const slashCommands = useMemo(() => session?.slashCommands || [], [session?.slashCommands])

  const handleOpenQuickPanel = useCallback(() => {
    if (quickPanelHook.isVisible && quickPanelHook.symbol === QuickPanelReservedSymbol.SlashCommands) {
      quickPanel.close()
    } else {
      openPanel()
    }
  }, [quickPanel, quickPanelHook, openPanel])

  const hasCommands = slashCommands.length > 0
  const isActive = quickPanelHook.isVisible && quickPanelHook.symbol === QuickPanelReservedSymbol.SlashCommands

  return (
    <Tooltip placement="top" title={t('chat.input.slash_commands')} mouseLeaveDelay={0} arrow>
      <ActionIconButton onClick={handleOpenQuickPanel} active={isActive} disabled={!hasCommands}>
        <Terminal size={18} />
      </ActionIconButton>
    </Tooltip>
  )
}

export default SlashCommandsButton
