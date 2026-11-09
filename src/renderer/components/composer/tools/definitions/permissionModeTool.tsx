import { useCallback, useEffect, useMemo, useState } from 'react'

import { ConfirmDialog } from '@cherrystudio/ui'
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
import { useTopicStreamStatus } from '@renderer/hooks/useTopicStreamStatus'
import type { PermissionMode } from '@renderer/types/agent'
import { getPermissionModeCards } from '@renderer/utils/agent'
import { buildAgentSessionTopicId } from '@renderer/utils/agentSession'
import { classifyTurn } from '@shared/ai/transport'

type PermissionModeContext = ToolRenderContext<readonly [], readonly []>

const usePermissionModeToolController = (context: PermissionModeContext) => {
  const { t, launcher, session: sessionContext } = context
  const agentId = sessionContext?.agentId
  const { agent } = useAgent(agentId ?? '')
  const { updateAgent } = useUpdateAgent()
  const { status: sessionStatus } = useTopicStreamStatus(buildAgentSessionTopicId(sessionContext?.sessionId ?? ''))
  const turnActive = classifyTurn(sessionStatus).isTurnActive

  // Permission mode lives on the agent — sessions are pure instances. Approval is governed
  // solely by the permission mode (the per-tool allow-list was removed).
  const currentMode = agent?.configuration?.permission_mode ?? 'default'
  const permissionModeCards = useMemo(() => getPermissionModeCards(agent?.type), [agent?.type])
  const planCard = permissionModeCards.find((card) => card.mode === 'plan')
  // A mode held behind a confirmation: Full Access always, any other mode only while a turn runs.
  const [pendingMode, setPendingMode] = useState<PermissionMode | null>(null)

  // Returns false when there is no agent yet so the confirm dialog stays open.
  const applyMode = useCallback(
    (nextMode: PermissionMode) => {
      if (!agentId || !agent) return false
      void updateAgent({ id: agentId, configuration: { permission_mode: nextMode } }, { showSuccessToast: false })
      return true
    },
    [agent, agentId, updateAgent]
  )

  const handleSelectMode = useCallback(
    (nextMode: PermissionMode) => {
      if (nextMode === currentMode) return
      if (nextMode === 'bypassPermissions' || turnActive) {
        setPendingMode(nextMode)
        return
      }
      setPendingMode(null)
      applyMode(nextMode)
    },
    [applyMode, currentMode, turnActive]
  )

  // Any newer mode (local or incoming) wins; confirming must never apply a stale dialog over it.
  useEffect(() => {
    setPendingMode(null)
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
              action: () => handleSelectMode(currentMode === 'plan' ? 'default' : 'plan')
            }
          ]
        : [])
    ])
  }, [currentMode, handleSelectMode, launcher, launcherLabel, launcherTooltip, modeSubmenu, planCard, t, tooltipTitle])

  const pendingCard = permissionModeCards.find((card) => card.mode === pendingMode)

  return {
    currentMode,
    tooltipTitle,
    pendingMode,
    pendingModeTitle: pendingCard ? t(pendingCard.titleKey, pendingCard.titleFallback) : '',
    setPendingMode,
    applyMode,
    agentName: agent?.name.trim() || undefined
  }
}

const PermissionModeComposerRuntime = ({ context }: { context: PermissionModeContext }) => {
  const { t } = context
  const { pendingMode, pendingModeTitle, setPendingMode, applyMode, agentName } =
    usePermissionModeToolController(context)
  const closeOnDismiss = (open: boolean) => {
    if (!open) setPendingMode(null)
  }

  return (
    <>
      <FullAccessConfirmDialog
        open={pendingMode === 'bypassPermissions'}
        onOpenChange={closeOnDismiss}
        onConfirm={() => applyMode('bypassPermissions')}
        scopeName={agentName}
        t={t}
      />
      <ConfirmDialog
        open={pendingMode !== null && pendingMode !== 'bypassPermissions'}
        onOpenChange={closeOnDismiss}
        title={t('agent.settings.tooling.permissionMode.runningSwitchConfirm.title', 'Switch permission mode now?')}
        description={t(
          'agent.settings.tooling.permissionMode.runningSwitchConfirm.description',
          'This session is running a task. The new mode applies right away: its next tool call will follow {{mode}}.',
          { mode: pendingModeTitle }
        )}
        content={
          agentName ? (
            <p className="text-sm">
              <span className="text-muted-foreground">
                {t('agent.settings.tooling.permissionMode.fullAccessConfirm.agentLabel', 'Agent')}:{' '}
              </span>
              <span className="font-medium text-foreground">{agentName}</span>
            </p>
          ) : null
        }
        confirmText={t('agent.settings.tooling.permissionMode.runningSwitchConfirm.confirm', 'Switch Now')}
        cancelText={t('common.cancel', 'Cancel')}
        onConfirm={() => (pendingMode ? applyMode(pendingMode) : undefined)}
      />
    </>
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
