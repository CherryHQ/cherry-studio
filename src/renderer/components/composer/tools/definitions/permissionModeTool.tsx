import { useCallback, useEffect, useMemo, useState } from 'react'

import { getQuickPanelSearchAliases } from '@renderer/components/composer/quickPanel'
import { PERMISSION_MODE_TOOLBAR_MANIFEST } from '@renderer/components/composer/tools/toolbarManifests'
import { defineTool, type ToolRenderContext } from '@renderer/components/composer/tools/types'
import {
  FullAccessConfirmDialog,
  PermissionModeIcon,
  PermissionModeOptionLabel,
  PermissionModeWarning
} from '@renderer/components/PermissionModeOption'
import { useAgent } from '@renderer/hooks/agent/useAgent'
import { useUpdateAgent } from '@renderer/hooks/agent/useAgent'
import type { PermissionMode, PermissionModeCard } from '@renderer/types/agent'
import { getPermissionModeCards } from '@renderer/utils/agent'

type PermissionModeContext = ToolRenderContext<readonly [], readonly []>

export const PermissionModeLauncherRuntime = ({
  t,
  launcher,
  currentMode,
  permissionModeCards,
  applyMode,
  scopeName,
  disabled = false
}: Pick<PermissionModeContext, 't' | 'launcher'> & {
  currentMode: PermissionMode
  permissionModeCards: PermissionModeCard[]
  applyMode: (mode: PermissionMode) => boolean | void
  scopeName?: string
  disabled?: boolean
}) => {
  const planCard = permissionModeCards.find((card) => card.mode === 'plan')
  const [fullAccessPending, setFullAccessPending] = useState(false)

  const handleSelectMode = useCallback(
    (nextMode: PermissionMode) => {
      if (disabled || nextMode === currentMode) return
      if (nextMode === 'bypassPermissions') {
        setFullAccessPending(true)
        return
      }
      setFullAccessPending(false)
      applyMode(nextMode)
    },
    [applyMode, currentMode, disabled]
  )

  // Any newer mode (local or incoming) wins; confirming must never apply a stale dialog over it.
  useEffect(() => {
    setFullAccessPending(false)
  }, [currentMode])

  const modeCard = permissionModeCards.find((card) => card.mode === currentMode)
  const tooltipTitle = modeCard ? t(modeCard.titleKey, modeCard.titleFallback) : ''
  const launcherLabel = t('agent.settings.permissionMode.title', 'Permission Mode')
  const launcherTooltip = tooltipTitle ? `${launcherLabel} · ${tooltipTitle}` : launcherLabel
  const modeSubmenu = useMemo(
    () =>
      permissionModeCards
        .filter((card) => card.mode !== 'plan')
        .map((card, index) => ({
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
          disabled,
          action: () => handleSelectMode(card.mode)
        })),
    [currentMode, disabled, handleSelectMode, permissionModeCards, t]
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
        disabled,
        submenu: modeSubmenu
      },
      ...(planCard
        ? [
            {
              id: 'plan-mode',
              kind: 'command' as const,
              sources: ['popover', 'root-panel'] as const,
              order: 79,
              label: t(planCard.titleKey, planCard.titleFallback),
              description: t(planCard.descriptionKey, planCard.descriptionFallback),
              shortcut: 'Shift+Tab',
              icon: <PermissionModeIcon mode="plan" />,
              active: currentMode === 'plan',
              disabled,
              action: () => handleSelectMode(currentMode === 'plan' ? 'default' : 'plan')
            }
          ]
        : [])
    ])
  }, [
    currentMode,
    disabled,
    handleSelectMode,
    launcher,
    launcherLabel,
    launcherTooltip,
    modeSubmenu,
    planCard,
    t,
    tooltipTitle
  ])

  return (
    <FullAccessConfirmDialog
      open={fullAccessPending}
      onOpenChange={setFullAccessPending}
      onConfirm={() => (disabled ? false : applyMode('bypassPermissions'))}
      scopeName={scopeName}
      t={t}
    />
  )
}

const PermissionModeComposerRuntime = ({ context }: { context: PermissionModeContext }) => {
  const { t, launcher, session: sessionContext } = context
  const agentId = sessionContext?.agentId
  const { agent } = useAgent(agentId ?? '')
  const { updateAgent } = useUpdateAgent()
  const permissionModeCards = useMemo(() => getPermissionModeCards(agent?.type), [agent?.type])
  // Permission mode lives on the agent; other composers supply their own controlled value.
  const applyMode = useCallback(
    (nextMode: PermissionMode) => {
      if (!agentId || !agent) return false
      void updateAgent({ id: agentId, configuration: { permission_mode: nextMode } }, { showSuccessToast: false })
      return true
    },
    [agent, agentId, updateAgent]
  )

  return (
    <PermissionModeLauncherRuntime
      t={t}
      launcher={launcher}
      currentMode={agent?.configuration?.permission_mode ?? 'default'}
      permissionModeCards={permissionModeCards}
      applyMode={applyMode}
      scopeName={agent?.name.trim() || undefined}
    />
  )
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
