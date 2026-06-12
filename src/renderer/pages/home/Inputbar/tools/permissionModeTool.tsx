import { ActionIconButton } from '@renderer/components/Buttons'
import { permissionModeCards } from '@renderer/config/agent'
import { defaultConfiguration } from '@renderer/hooks/agents/agentConfiguration'
import { useAgent } from '@renderer/hooks/agents/useAgent'
import { useUpdateAgent } from '@renderer/hooks/agents/useAgent'
import type { PermissionMode } from '@renderer/types'
import { Tooltip } from 'antd'
import { FolderPen, Pointer, RefreshCcw, Route } from 'lucide-react'
import type { ReactNode } from 'react'
import { useCallback } from 'react'

import { defineTool, registerTool, TopicType } from '../types'

const getPermissionModeIcon = (mode: PermissionMode): ReactNode => {
  switch (mode) {
    case 'default':
      return <Pointer size={18} color="#00b96b" />
    case 'plan':
      return <Route size={18} color="#faad14" />
    case 'acceptEdits':
      return <FolderPen size={18} color="#52c41a" />
    case 'bypassPermissions':
      return <RefreshCcw size={18} color="#722ed1" />
    default:
      return <Pointer size={18} color="#00b96b" />
  }
}

const SYMBOL = 'permission-mode'

const permissionModeTool = defineTool({
  key: 'permission_mode',
  label: (t) => t('agent.settings.permissionMode.title', 'Permission Mode'),
  visibleInScopes: [TopicType.Session],

  render: function PermissionModeRender(context) {
    const { t, session: sessionContext, quickPanelController } = context
    const agentId = sessionContext?.agentId
    const { agent } = useAgent(agentId ?? '')
    const { updateAgent } = useUpdateAgent()

    // Permission mode, disabledTools, and the tool catalog all live on the agent
    // — sessions are pure instances. UI writes the agent record directly.
    const currentMode = agent?.configuration?.permission_mode ?? 'default'
    const handleSelectMode = useCallback(
      (nextMode: PermissionMode) => {
        if (!agentId || !agent || nextMode === currentMode) return

        const configuration = agent.configuration ?? defaultConfiguration
        const updatedConfiguration = { ...configuration, permission_mode: nextMode }

        // Disable soul mode when switching away from bypassPermissions
        if (nextMode !== 'bypassPermissions' && configuration.soul_enabled === true) {
          updatedConfiguration.soul_enabled = false
        }

        void updateAgent(
          {
            id: agentId,
            configuration: updatedConfiguration
          },
          { showSuccessToast: false }
        )
      },
      [currentMode, agent, agentId, updateAgent]
    )

    const handleClick = useCallback(() => {
      // Toggle: close if already open with the same symbol
      if (quickPanelController.isVisible && quickPanelController.symbol === SYMBOL) {
        quickPanelController.close('esc')
        return
      }

      quickPanelController.open({
        title: t('agent.settings.permissionMode.title', 'Permission Mode'),
        symbol: SYMBOL,
        list: permissionModeCards.map((card) => ({
          label: t(card.titleKey, card.titleFallback),
          description: t(card.descriptionKey, card.descriptionFallback),
          icon: getPermissionModeIcon(card.mode),
          isSelected: card.mode === currentMode,
          action: () => handleSelectMode(card.mode)
        }))
      })
    }, [quickPanelController, t, currentMode, handleSelectMode])

    const modeCard = permissionModeCards.find((card) => card.mode === currentMode)
    const tooltipTitle = modeCard ? t(modeCard.titleKey, modeCard.titleFallback) : ''

    return (
      <Tooltip placement="top" title={tooltipTitle}>
        <ActionIconButton onClick={handleClick} icon={getPermissionModeIcon(currentMode)} />
      </Tooltip>
    )
  }
})

registerTool(permissionModeTool)

export default permissionModeTool
