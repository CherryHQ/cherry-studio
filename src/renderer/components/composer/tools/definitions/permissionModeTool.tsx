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
import { isAgentFullAccessMode } from '@shared/ai/agentPermissionMode'
import { ACP_HOST_PERMISSION_MODE_ID } from '@shared/ai/localAgent'

type PermissionMenuCard = PermissionModeCard & { value: string; nativeName?: string; nativeDescription?: string }

type PermissionModeContext = ToolRenderContext<readonly [], readonly []>

const usePermissionModeToolController = (context: PermissionModeContext) => {
  const { t, launcher, session: sessionContext } = context
  const agentId = sessionContext?.agentId
  const sessionId = sessionContext?.sessionId
  const isLocal = sessionContext?.agentType === 'local'
  const localPermission = sessionContext?.localPermission
  const localHost = localPermission?.mode?.id === ACP_HOST_PERMISSION_MODE_ID
  const { agent } = useAgent(agentId ?? '')
  const { updateAgent } = useUpdateAgent()

  const unifiedLocalMode = useMemo(
    () => (isLocal ? resolveUnifiedLocalPermissionModes(localPermission?.mode) : undefined),
    [isLocal, localPermission?.mode]
  )

  // Permission mode lives on the agent for built-in runtimes and on the session for local agents.
  const currentMode: PermissionMode = isLocal
    ? (unifiedLocalMode?.currentCanonicalMode ?? 'default')
    : (agent?.configuration?.permission_mode ?? 'default')
  const currentValue = localPermission?.mode?.currentValue ?? currentMode
  const permissionModeCards = useMemo<PermissionMenuCard[]>(() => {
    if (!isLocal) return getPermissionModeCards(agent?.type).map((card) => ({ ...card, value: card.mode }))
    if (!unifiedLocalMode) return []
    const canonicalByMode = new Map(getPermissionModeCards(undefined).map((card) => [card.mode, card]))
    return unifiedLocalMode.options.flatMap<PermissionMenuCard>(({ canonicalMode, value, name, description }) => {
      const card = canonicalByMode.get(canonicalMode)
      if (!card) return []
      if (localHost && card.mode === 'bypassPermissions') {
        return [
          {
            ...card,
            value,
            descriptionKey: 'local_agents.host_permission.bypass_description',
            descriptionFallback: 'Automatically approves eligible tool requests for this session.',
            warningKey: undefined
          }
        ]
      }
      return [{ ...card, value, nativeName: name, nativeDescription: description }]
    })
  }, [agent?.type, isLocal, localHost, unifiedLocalMode])
  const planCard = permissionModeCards.find((card) => card.mode === 'plan')
  const isDisabled = Boolean(isLocal && localPermission?.disabled)
  const localExitPlanMode = useMemo(() => {
    if (!planCard || !localPermission?.mode) return undefined
    const safeNativeOption = findLocalDefaultNonPlanOption(localPermission.mode, planCard.value)
    return permissionModeCards.find((card) => card.value === safeNativeOption?.value)
  }, [localPermission?.mode, permissionModeCards, planCard])
  const [fullAccessPending, setFullAccessPending] = useState<PermissionMenuCard>()

  // Returns false when the selection cannot apply right now so the confirm dialog stays open.
  const applyMode = useCallback(
    (nextMode: PermissionMenuCard) => {
      if (isLocal) {
        if (!sessionId || !unifiedLocalMode || localPermission?.disabled) return false
        if (!unifiedLocalMode.options.some(({ value }) => value === nextMode.value)) return false
        void ipcApi
          .request('ai.local_agents.set_mode', {
            sessionId,
            configId: unifiedLocalMode.id,
            value: nextMode.value
          })
          .catch((error) => toast.error(String(error)))
        return true
      }
      if (!agentId || !agent) return false
      void updateAgent({ id: agentId, configuration: { permission_mode: nextMode.mode } }, { showSuccessToast: false })
      return true
    },
    [agent, agentId, isLocal, localPermission?.disabled, sessionId, unifiedLocalMode, updateAgent]
  )

  const handleSelectMode = useCallback(
    (nextMode: PermissionMenuCard) => {
      if (isDisabled || nextMode.value === currentValue) return
      if (isAgentFullAccessMode(nextMode.mode)) {
        setFullAccessPending(nextMode)
        return
      }
      setFullAccessPending(undefined)
      applyMode(nextMode)
    },
    [applyMode, currentValue, isDisabled]
  )

  // Any newer mode (local or incoming) wins; confirming must never apply a stale dialog over it.
  useEffect(() => {
    setFullAccessPending(undefined)
  }, [agentId, currentValue, sessionId, unifiedLocalMode?.id])

  const modeCard = permissionModeCards.find((card) => card.value === currentValue)
  const workflowName = localPermission?.mode?.options.find(
    ({ value, workflowOnly }) => value === currentValue && workflowOnly
  )?.name
  const tooltipTitle = modeCard
    ? (modeCard.nativeName ?? t(modeCard.titleKey, modeCard.titleFallback))
    : (workflowName ?? '')
  const launcherLabel = t('agent.settings.permissionMode.title', 'Permission Mode')
  const launcherTooltip = tooltipTitle ? `${launcherLabel} · ${tooltipTitle}` : launcherLabel
  const disabledReason = isDisabled ? t('local_agents.configuration_read_only') : undefined
  const modeSubmenu = useMemo(
    () =>
      permissionModeCards
        .filter((card) => card.mode !== 'plan')
        .map((card, index) => {
          const description = card.nativeName
            ? card.nativeDescription
            : t(card.descriptionKey, card.descriptionFallback)
          return {
            id: `permission-mode-${card.nativeName ? card.value : card.mode}`,
            kind: 'command' as const,
            sources: ['popover'] as const,
            order: 80 + index / 100,
            // The quick panel row stays single-line; the full warning remains available on demand.
            label: card.nativeName ?? <PermissionModeOptionLabel card={card} t={t} withDescription={false} />,
            // label/description are React nodes, which yield no searchable text — provide it explicitly.
            searchAliases: getQuickPanelSearchAliases(t, card.titleKey, [
              card.nativeName ?? t(card.titleKey, card.titleFallback),
              description ?? ''
            ]),
            description: description && (
              <span className={card.dangerous ? 'text-destructive' : undefined}>{description}</span>
            ),
            tooltip:
              card.warningKey && (!card.nativeName || card.dangerous)
                ? t(card.warningKey, card.warningFallback ?? '')
                : undefined,
            tooltipAnchor:
              card.warningKey && (!card.nativeName || card.dangerous) ? (
                <PermissionModeWarning card={card} showTooltip={false} t={t} />
              ) : undefined,
            icon: <PermissionModeIcon mode={card.mode} />,
            active: card.value === currentValue,
            ...(isDisabled ? { disabled: true, disabledReason } : {}),
            action: () => handleSelectMode(card)
          }
        }),
    [currentValue, disabledReason, handleSelectMode, isDisabled, permissionModeCards, t]
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
                  handleSelectMode(planCard)
                  return
                }
                const exitMode = isLocal
                  ? localExitPlanMode
                  : permissionModeCards.find(({ mode }) => mode === 'default')
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
    permissionModeCards,
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
    localHost,
    agentName: agent?.name.trim() || undefined
  }
}

const PermissionModeComposerRuntime = ({ context }: { context: PermissionModeContext }) => {
  const { t } = context
  const { fullAccessPending, setFullAccessPending, applyMode, agentName, localHost } =
    usePermissionModeToolController(context)

  return (
    <FullAccessConfirmDialog
      open={Boolean(fullAccessPending)}
      onOpenChange={(open) => {
        if (!open) setFullAccessPending(undefined)
      }}
      onConfirm={() => !!fullAccessPending && applyMode(fullAccessPending)}
      scopeName={agentName}
      localHost={localHost}
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
    !!session && (session.agentType !== 'local' || isUnifiedLocalPermissionMode(session.localPermission?.mode)),

  composer: {
    runtime: ({ context }) => <PermissionModeComposerRuntime context={context} />
  }
})

export default permissionModeTool
