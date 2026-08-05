import { useCallback, useEffect, useMemo } from 'react'

import { getQuickPanelSearchAliases } from '@renderer/components/composer/quickPanel'
import { PERMISSION_MODE_TOOLBAR_MANIFEST } from '@renderer/components/composer/tools/toolbarManifests'
import { defineTool, type ToolRenderContext } from '@renderer/components/composer/tools/types'
import { PermissionModeIcon, PermissionModeOptionLabel } from '@renderer/components/PermissionModeOption'
import { useAgent } from '@renderer/hooks/agent/useAgent'
import { useUpdateAgent } from '@renderer/hooks/agent/useAgent'
import type { PermissionMode } from '@renderer/types/agent'
import { permissionModeCards } from '@renderer/utils/agent'

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

      void updateAgent({ id: agentId, configuration: { permission_mode: nextMode } }, { showSuccessToast: false })
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
        // The quick panel row is a fixed-height single line, so the label stays one line and
        // the mode's caveat rides along in the description column instead of stacking below.
        label: <PermissionModeOptionLabel card={card} t={t} withDescription={false} withWarning={false} />,
        // label/description are React nodes, which yield no searchable text — provide it explicitly.
        searchAliases: getQuickPanelSearchAliases(t, card.titleKey, [
          t(card.titleKey, card.titleFallback),
          t(card.descriptionKey, card.descriptionFallback)
        ]),
        description: (
          <span className={card.dangerous ? 'text-destructive/80' : undefined}>
            {t(card.descriptionKey, card.descriptionFallback)}
            {card.warningKey && (
              <span className={card.dangerous ? undefined : 'text-warning'}>
                {' · '}
                {t(card.warningKey, card.warningFallback ?? '')}
              </span>
            )}
          </span>
        ),
        icon: <PermissionModeIcon mode={card.mode} />,
        active: card.mode === currentMode,
        action: () => handleSelectMode(card.mode)
      })),
    [currentMode, handleSelectMode, t]
  )

  useEffect(() => {
    return launcher.registerLaunchers([
      {
        ...PERMISSION_MODE_TOOLBAR_MANIFEST.toolbar,
        sources: ['popover'],
        label: t('agent.settings.permissionMode.title', 'Permission Mode'),
        description: '',
        searchAliases: getQuickPanelSearchAliases(t, 'agent.settings.permissionMode.title'),
        icon: <PermissionModeIcon mode={currentMode} />,
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
  label: PERMISSION_MODE_TOOLBAR_MANIFEST.label,
  visibleInScopes: PERMISSION_MODE_TOOLBAR_MANIFEST.visibleInScopes,

  composer: {
    runtime: ({ context }) => <PermissionModeComposerRuntime context={context} />
  }
})

export default permissionModeTool
