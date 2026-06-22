import {
  defineTool,
  registerTool,
  type ToolRenderContext,
  TopicType
} from '@renderer/components/chat/composer/tools/types'
import { permissionModeCards } from '@renderer/config/agent'
import { defaultConfiguration } from '@renderer/hooks/agents/agentConfiguration'
import { useAgent } from '@renderer/hooks/agents/useAgent'
import { useUpdateAgent } from '@renderer/hooks/agents/useAgent'
import type { PermissionMode } from '@renderer/types'
import { FolderPen, Pointer, RefreshCcw, Route } from 'lucide-react'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo } from 'react'

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

type PermissionModeContext = ToolRenderContext<readonly [], readonly []>

const usePermissionModeToolController = (context: PermissionModeContext) => {
  const { t, launcher, session: sessionContext } = context
  const agentId = sessionContext?.agentId
  const { agent } = useAgent(agentId ?? '')
  const { updateAgent } = useUpdateAgent()

  // Permission mode lives on the agent — sessions are pure instances. Approval is governed
  // solely by the permission mode (the per-tool allow-list was removed).
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

      void updateAgent({ id: agentId, configuration: updatedConfiguration }, { showSuccessToast: false })
    },
    [currentMode, agent, agentId, updateAgent]
  )

  const modeCard = permissionModeCards.find((card) => card.mode === currentMode)
  const tooltipTitle = modeCard ? t(modeCard.titleKey, modeCard.titleFallback) : ''
  const modeSubmenu = useMemo(
    () =>
      permissionModeCards.map((card, index) => ({
        id: `permission-mode-${card.mode}`,
        kind: 'command' as const,
        sources: ['popover'] as const,
        order: 80 + index / 100,
        label: t(card.titleKey, card.titleFallback),
        description: t(card.descriptionKey, card.descriptionFallback),
        icon: getPermissionModeIcon(card.mode),
        active: card.mode === currentMode,
        action: () => handleSelectMode(card.mode)
      })),
    [currentMode, handleSelectMode, t]
  )

  useEffect(() => {
    return launcher.registerLaunchers([
      {
        id: 'permission-mode',
        kind: 'group',
        sources: ['popover'],
        order: 80,
        label: t('agent.settings.permissionMode.title', 'Permission Mode'),
        description: '',
        icon: getPermissionModeIcon(currentMode),
        suffix: tooltipTitle,
        submenu: modeSubmenu
      }
    ])
  }, [currentMode, launcher, modeSubmenu, t, tooltipTitle])

  return { currentMode, tooltipTitle }
}

const PermissionModeComposerRuntime = ({ context }: { context: PermissionModeContext }) => {
  usePermissionModeToolController(context)
  return null
}

const permissionModeTool = defineTool({
  key: 'permission_mode',
  label: (t) => t('agent.settings.permissionMode.title', 'Permission Mode'),
  visibleInScopes: [TopicType.Session],

  composer: {
    runtime: ({ context }) => <PermissionModeComposerRuntime context={context} />
  }
})

registerTool(permissionModeTool)

export default permissionModeTool
