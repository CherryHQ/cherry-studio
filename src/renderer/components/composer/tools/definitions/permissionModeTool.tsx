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
import { useAgent, useUpdateAgent } from '@renderer/hooks/agent/useAgent'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import type { PermissionMode, PermissionModeCard } from '@renderer/types/agent'
import { getPermissionModeCards } from '@renderer/utils/agent'
import {
  findLocalDefaultNonPlanOption,
  isUnifiedLocalPermissionMode,
  resolveUnifiedLocalPermissionModes
} from '@renderer/utils/agent/localAgentLabels'

type PermissionModeContext = ToolRenderContext<readonly [], readonly []>

const usePermissionModeToolController = (context: PermissionModeContext) => {
  const { t, launcher, session: sessionContext } = context
  const agentId = sessionContext?.agentId
  const sessionId = sessionContext?.sessionId
  const isLocal = sessionContext?.agentType === 'local'
  const localPermission = sessionContext?.localPermission
  const { agent } = useAgent(agentId ?? '')
  const { updateAgent } = useUpdateAgent()

  const unifiedLocalMode = useMemo(
    () =>
      isLocal ? resolveUnifiedLocalPermissionModes(localPermission?.mode, t, localPermission?.presetId) : undefined,
    [isLocal, localPermission?.mode, localPermission?.presetId, t]
  )

  // Permission mode lives on the agent for built-in runtimes and on the session for local agents.
  const currentMode: PermissionMode = isLocal
    ? (unifiedLocalMode?.currentCanonicalMode ?? 'default')
    : (agent?.configuration?.permission_mode ?? 'default')
  const permissionModeCards = useMemo<PermissionModeCard[]>(() => {
    if (!isLocal) return getPermissionModeCards(agent?.type)
    if (!unifiedLocalMode) return []
    const canonicalByMode = new Map(getPermissionModeCards(undefined).map((card) => [card.mode, card]))
    return unifiedLocalMode.options
      .map((option) => canonicalByMode.get(option.canonicalMode))
      .filter((card): card is PermissionModeCard => Boolean(card))
  }, [agent?.type, isLocal, unifiedLocalMode])
  const planCard = permissionModeCards.find((card) => card.mode === 'plan')
  const isDisabled = Boolean(isLocal && localPermission?.disabled)
  const localExitPlanMode = useMemo(() => {
    if (!isLocal || !unifiedLocalMode || !localPermission?.mode) return undefined
    const planOption = unifiedLocalMode.options.find((option) => option.canonicalMode === 'plan')
    if (!planOption) return undefined
    const safeNativeOption = findLocalDefaultNonPlanOption(localPermission.mode, planOption.value)
    if (!safeNativeOption) return undefined
    return unifiedLocalMode.options.find((option) => option.value === safeNativeOption.value)?.canonicalMode
  }, [isLocal, localPermission?.mode, unifiedLocalMode])
  const [fullAccessPending, setFullAccessPending] = useState(false)

  // Returns false when the selection cannot apply right now so the confirm dialog stays open.
  const applyMode = useCallback(
    (nextMode: PermissionMode) => {
      if (isLocal) {
        if (!sessionId || !unifiedLocalMode || localPermission?.disabled) return false
        const targetOption = unifiedLocalMode.options.find((option) => option.canonicalMode === nextMode)
        if (!targetOption) return false
        const method =
          localPermission?.kind === 'config' ? 'ai.local_agents.set_config_option' : 'ai.local_agents.set_mode'
        void ipcApi
          .request(method, {
            sessionId,
            configId: unifiedLocalMode.id,
            value: targetOption.value
          })
          .catch((error) => toast.error(String(error)))
        return true
      }
      if (!agentId || !agent) return false
      void updateAgent({ id: agentId, configuration: { permission_mode: nextMode } }, { showSuccessToast: false })
      return true
    },
    [
      agent,
      agentId,
      isLocal,
      localPermission?.disabled,
      localPermission?.kind,
      sessionId,
      unifiedLocalMode,
      updateAgent
    ]
  )

  const handleSelectMode = useCallback(
    (nextMode: PermissionMode) => {
      if (isDisabled || nextMode === currentMode) return
      if (nextMode === 'bypassPermissions') {
        setFullAccessPending(true)
        return
      }
      setFullAccessPending(false)
      applyMode(nextMode)
    },
    [applyMode, currentMode, isDisabled]
  )

  // Any newer mode (local or incoming) wins; confirming must never apply a stale dialog over it.
  useEffect(() => {
    setFullAccessPending(false)
  }, [agentId, currentMode, sessionId])

  const modeCard = permissionModeCards.find((card) => card.mode === currentMode)
  const tooltipTitle = modeCard ? t(modeCard.titleKey, modeCard.titleFallback) : ''
  const launcherLabel = t('agent.settings.permissionMode.title', 'Permission Mode')
  const launcherTooltip = tooltipTitle ? `${launcherLabel} · ${tooltipTitle}` : launcherLabel
  const disabledReason = isDisabled ? t('local_agents.configuration_read_only') : undefined
  const modeSubmenu = useMemo(
    () =>
      permissionModeCards
        .filter((card) => isLocal || card.mode !== 'plan')
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
          ...(isDisabled ? { disabled: true, disabledReason } : {}),
          action: () => handleSelectMode(card.mode)
        })),
    [currentMode, disabledReason, handleSelectMode, isDisabled, isLocal, permissionModeCards, t]
  )

  useEffect(() => {
    if (isLocal && !unifiedLocalMode) return
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
              ...(isLocal ? { showInActiveControls: false } : {}),
              ...(isDisabled ? { disabled: true, disabledReason } : {}),
              action: () => {
                if (currentMode !== 'plan') {
                  handleSelectMode('plan')
                  return
                }
                const exitMode = isLocal ? localExitPlanMode : 'default'
                if (exitMode) handleSelectMode(exitMode)
              }
            }
          ]
        : [])
    ])
  }, [
    currentMode,
    disabledReason,
    handleSelectMode,
    isDisabled,
    isLocal,
    launcher,
    launcherLabel,
    launcherTooltip,
    localExitPlanMode,
    modeSubmenu,
    planCard,
    t,
    tooltipTitle,
    unifiedLocalMode
  ])

  return {
    currentMode,
    tooltipTitle,
    fullAccessPending,
    setFullAccessPending,
    applyMode,
    agentName: agent?.name.trim() || undefined
  }
}

const PermissionModeComposerRuntime = ({ context }: { context: PermissionModeContext }) => {
  const { t } = context
  const { fullAccessPending, setFullAccessPending, applyMode, agentName } = usePermissionModeToolController(context)

  return (
    <FullAccessConfirmDialog
      open={fullAccessPending}
      onOpenChange={setFullAccessPending}
      onConfirm={() => applyMode('bypassPermissions')}
      scopeName={agentName}
      t={t}
    />
  )
}

const permissionModeTool = defineTool({
  key: 'permission_mode',
  label: PERMISSION_MODE_TOOLBAR_MANIFEST.label,
  availableWithoutModel: true,
  visibleInScopes: PERMISSION_MODE_TOOLBAR_MANIFEST.visibleInScopes,
  condition: ({ session }) =>
    !!session &&
    (session.agentType !== 'local' ||
      isUnifiedLocalPermissionMode(session.localPermission?.mode, session.localPermission?.presetId)),

  composer: {
    runtime: ({ context }) => <PermissionModeComposerRuntime context={context} />
  }
})

export default permissionModeTool
