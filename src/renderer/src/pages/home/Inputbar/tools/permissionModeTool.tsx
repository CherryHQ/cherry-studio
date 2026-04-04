import { ActionIconButton } from '@renderer/components/Buttons'
import { permissionModeCards } from '@renderer/config/agent'
import { useActiveSession } from '@renderer/hooks/agents/useActiveSession'
import { useAgent } from '@renderer/hooks/agents/useAgent'
import { useUpdateAgent } from '@renderer/hooks/agents/useUpdateAgent'
import { useUpdateSession } from '@renderer/hooks/agents/useUpdateSession'
import { computeModeDefaults, defaultConfiguration } from '@renderer/pages/settings/AgentSettings/shared'
import type { PermissionMode } from '@renderer/types'
import { Tooltip } from 'antd'
import { uniq } from 'lodash'
import { FolderPen, Pointer, RefreshCcw, Route } from 'lucide-react'
import type { ReactNode } from 'react'
import { useCallback, useMemo } from 'react'

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
    const { session } = useActiveSession()
    const { agent } = useAgent(agentId ?? '')
    const { updateAgent } = useUpdateAgent()
    const { updateSession } = useUpdateSession(agentId ?? null)

    const currentMode = session?.configuration?.permission_mode ?? 'default'
    const availableTools = useMemo(() => session?.tools ?? [], [session?.tools])

    const handleSelectMode = useCallback(
      (nextMode: PermissionMode) => {
        if (!session || nextMode === currentMode) return

        const configuration = session.configuration ?? defaultConfiguration
        const currentAutoToolIds = computeModeDefaults(currentMode, availableTools)
        const nextAutoToolIds = computeModeDefaults(nextMode, availableTools)

        const currentAllowed = session.allowed_tools ?? []
        const userAddedIds = currentAllowed.filter((id) => !currentAutoToolIds.includes(id))
        const mergedAllowed = uniq([...nextAutoToolIds, ...userAddedIds])

        const updatedConfiguration = { ...configuration, permission_mode: nextMode }

        // Disable soul mode on the agent when switching away from bypassPermissions
        // Check agent-level soul_enabled since session may not have it
        if (nextMode !== 'bypassPermissions' && agentId && agent?.configuration?.soul_enabled === true) {
          updatedConfiguration.soul_enabled = false
          void updateAgent(
            {
              id: agentId,
              configuration: { ...agent.configuration, soul_enabled: false, permission_mode: nextMode }
            },
            { showSuccessToast: false }
          )
        }

        void updateSession(
          {
            id: session.id,
            configuration: updatedConfiguration,
            allowed_tools: mergedAllowed
          },
          { showSuccessToast: false }
        )
      },
      [currentMode, session, availableTools, updateSession, agentId, agent, updateAgent]
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
        <ActionIconButton onClick={handleClick}>{getPermissionModeIcon(currentMode)}</ActionIconButton>
      </Tooltip>
    )
  }
})

registerTool(permissionModeTool)

export default permissionModeTool
