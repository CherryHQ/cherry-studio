import { getQuickPanelSearchAliases } from '@renderer/components/composer/quickPanel'
import { PERMISSION_MODE_TOOLBAR_MANIFEST } from '@renderer/components/composer/tools/toolbarManifests'
import { defineTool, type ToolRenderContext } from '@renderer/components/composer/tools/types'
import {
  PermissionModeIcon,
  PermissionModeOptionLabel,
  PermissionModeWarning
} from '@renderer/components/PermissionModeOption'
import { useAgent } from '@renderer/hooks/agent/useAgent'
import { useUpdateAgent } from '@renderer/hooks/agent/useAgent'
import type { PermissionMode } from '@renderer/types/agent'
import { getPermissionModeCards } from '@renderer/utils/agent'
import { useCallback, useEffect, useMemo } from 'react'

type PermissionModeContext = ToolRenderContext<readonly [], readonly []>

const usePermissionModeToolController = (context: PermissionModeContext) => {
  const { t, launcher, session: sessionContext } = context
  const agentId = sessionContext?.agentId
  const { agent } = useAgent(agentId ?? '')
  const { updateAgent } = useUpdateAgent()

  // Permission mode lives on the agent — sessions are pure instances. Approval is governed
  // solely by the permission mode (the per-tool allow-list was removed).
  const currentMode = agent?.configuration?.permission_mode ?? 'default'
  const permissionModeCards = useMemo(() => getPermissionModeCards(agent?.type), [agent?.type])

  const handleSelectMode = useCallback(
    (nextMode: PermissionMode) => {
      if (!agentId || !agent || nextMode === currentMode) return

      void updateAgent({ id: agentId, configuration: { permission_mode: nextMode } }, { showSuccessToast: false })
    },
    [currentMode, agent, agentId, updateAgent]
  )

  const modeCard = permissionModeCards.find((card) => card.mode === currentMode)
  const tooltipTitle = modeCard ? t(modeCard.titleKey, modeCard.titleFallback) : ''
  const launcherLabel = t('agent.settings.permissionMode.title', 'Permission Mode')
  const launcherTooltip = tooltipTitle ? `${launcherLabel} · ${tooltipTitle}` : launcherLabel
  const modeSubmenu = useMemo(
    () =>
      permissionModeCards.map((card, index) => ({
        id: `permission-mode-${card.mode}`,
        kind: 'command' as const,
        sources: ['popover'] as const,
        order: 80 + index / 100,
        // The quick panel row stays single-line; the full warning remains available on demand.
        label: <PermissionModeOptionLabel card={card} t={t} withDescription={false} />,
        // label/description are React nodes, which yield no searchable text — provide it explicitly.
        searchAliases: getQuickPanelSearchAliases(t, card.titleKey, [
          t(card.titleKey, card.titleFallback),
          t(card.descriptionKey, card.descriptionFallback)
        ]),
        description: (
          <span className={card.dangerous ? 'text-destructive' : undefined}>
            {t(card.descriptionKey, card.descriptionFallback)}
          </span>
        ),
        tooltip: card.warningKey ? t(card.warningKey, card.warningFallback ?? '') : undefined,
        tooltipAnchor: card.warningKey ? <PermissionModeWarning card={card} showTooltip={false} t={t} /> : undefined,
        icon: <PermissionModeIcon mode={card.mode} />,
        active: card.mode === currentMode,
        action: () => handleSelectMode(card.mode)
      })),
    [currentMode, handleSelectMode, permissionModeCards, t]
  )

  useEffect(() => {
    return launcher.registerLaunchers([
      {
        ...PERMISSION_MODE_TOOLBAR_MANIFEST.toolbar,
        sources: ['popover'],
        label: launcherLabel,
        description: tooltipTitle,
        tooltip: launcherTooltip,
        searchAliases: getQuickPanelSearchAliases(t, 'agent.settings.permissionMode.title'),
        icon: <PermissionModeIcon mode={currentMode} />,
        submenu: modeSubmenu
      }
    ])
  }, [currentMode, launcher, launcherLabel, launcherTooltip, modeSubmenu, t, tooltipTitle])

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
