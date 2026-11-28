import { Settings2, Shield } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { requiresPermissionConfirmation } from '@cherrystudio/agent-runtime/cli'
import { getQuickPanelSearchAliases } from '@renderer/components/composer/quickPanel'
import type { ComposerToolLauncher } from '@renderer/components/composer/toolLauncher'
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
  localAgentConfigOptions,
  resolveUnifiedLocalPermissionModes
} from '@renderer/utils/agent/localAgentLabels'
import { isAgentFullAccessMode } from '@shared/ai/agentPermissionMode'
import { ACP_HOST_PERMISSION_MODE_ID } from '@shared/ai/localAgent'

type PermissionMenuCard = PermissionModeCard & { value: string; nativeName?: string; nativeDescription?: string }

type PermissionModeContext = ToolRenderContext<readonly [], readonly []>
type LocalConfigChange = { id: string; currentValue: string | boolean; value: string | boolean }

const usePermissionModeToolController = (context: PermissionModeContext) => {
  const { t, launcher, session: sessionContext } = context
  const agentId = sessionContext?.agentId
  const sessionId = sessionContext?.sessionId
  const isLocal = sessionContext?.agentType === 'local'
  const localPermission = sessionContext?.localPermission
  const localHost = localPermission?.mode?.id === ACP_HOST_PERMISSION_MODE_ID
  const { agent } = useAgent(agentId ?? '')
  const { updateAgent } = useUpdateAgent()
  const presetId = localPermission?.providerId ? localPermission.presetId : agent?.localRuntime?.presetId

  const unifiedLocalMode = useMemo(
    () => (isLocal ? resolveUnifiedLocalPermissionModes(localPermission?.mode) : undefined),
    [isLocal, localPermission?.mode]
  )

  const savedMode = agent?.configuration?.permission_mode
  const currentMode: PermissionMode = savedMode ?? unifiedLocalMode?.currentCanonicalMode ?? 'default'
  const currentValue = isLocal
    ? savedMode
      ? unifiedLocalMode?.options.find(({ canonicalMode }) => canonicalMode === savedMode)?.value
      : localPermission?.mode?.currentValue
    : currentMode
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
  const [configSaving, setConfigSaving] = useState(false)
  const isDisabled = Boolean(isLocal && (localPermission?.disabled || configSaving))
  const localExitPlanMode = useMemo(() => {
    if (!planCard || !localPermission?.mode) return undefined
    const safeNativeOption = findLocalDefaultNonPlanOption(localPermission.mode, planCard.value)
    return permissionModeCards.find((card) => card.value === safeNativeOption?.value)
  }, [localPermission?.mode, permissionModeCards, planCard])
  const [fullAccessPending, setFullAccessPending] = useState<PermissionMenuCard>()
  const [configPending, setConfigPending] = useState<LocalConfigChange>()

  const applyConfig = useCallback(
    (change: LocalConfigChange) => {
      const option = localPermission?.options?.find(({ id }) => id === change.id)
      if (!sessionId || isDisabled || !option || option.currentValue !== change.currentValue) return false
      setConfigSaving(true)
      void ipcApi
        .request('ai.local_agents.set_config_option', { sessionId, configId: change.id, value: change.value })
        .catch((error) => toast.error(String(error)))
        .finally(() => setConfigSaving(false))
      return true
    },
    [isDisabled, localPermission?.options, sessionId]
  )

  // Returns false when the selection cannot apply right now so the confirm dialog stays open.
  const applyMode = useCallback(
    (nextMode: PermissionMenuCard) => {
      if (!agentId || !agent || isDisabled) return false
      if (isLocal && !unifiedLocalMode?.options.some(({ value }) => value === nextMode.value)) return false
      void updateAgent({ id: agentId, configuration: { permission_mode: nextMode.mode } }, { showSuccessToast: false })
      return true
    },
    [agent, agentId, isDisabled, isLocal, unifiedLocalMode, updateAgent]
  )

  const handleSelectMode = useCallback(
    (nextMode: PermissionMenuCard) => {
      if (isDisabled || (nextMode.value === currentValue && (!isLocal || savedMode === nextMode.mode))) return
      setConfigPending(undefined)
      if (isAgentFullAccessMode(nextMode.mode)) {
        setFullAccessPending(nextMode)
        return
      }
      setFullAccessPending(undefined)
      applyMode(nextMode)
    },
    [applyMode, currentValue, isDisabled, isLocal, savedMode]
  )

  // Any newer mode (local or incoming) wins; confirming must never apply a stale dialog over it.
  useEffect(() => {
    setFullAccessPending(undefined)
    setConfigPending(undefined)
  }, [agentId, currentValue, savedMode, sessionId, unifiedLocalMode?.id])
  useEffect(() => {
    setConfigPending(undefined)
  }, [localPermission?.options])

  const modeCard = permissionModeCards.find((card) => card.value === currentValue)
  const workflowName = localPermission?.mode?.options.find(
    ({ value, workflowOnly }) => value === currentValue && workflowOnly
  )?.name
  const connectionStatus = localPermission?.unavailable
    ? t(localPermission.connecting ? 'common.loading' : 'local_agents.configuration_read_only')
    : undefined
  const tooltipTitle = localPermission?.connecting
    ? t('common.loading')
    : modeCard
      ? (modeCard.nativeName ?? t(modeCard.titleKey, modeCard.titleFallback))
      : (connectionStatus ?? workflowName ?? '')
  const launcherLabel = t('agent.settings.permissionMode.title', 'Permission Mode')
  const launcherTooltip = tooltipTitle ? `${launcherLabel} · ${tooltipTitle}` : launcherLabel
  const disabledReason = isDisabled
    ? t(localPermission?.connecting ? 'common.loading' : 'local_agents.configuration_read_only')
    : undefined
  const configMenus = useMemo(() => {
    const security: ComposerToolLauncher[] = []
    const session: ComposerToolLauncher[] = []
    for (const option of localAgentConfigOptions(localPermission?.options ?? [], presetId, t)) {
      const choose = (value: string | boolean, confirm: boolean) => {
        if (value === option.currentValue || isDisabled) return
        const change = { id: option.id, currentValue: option.currentValue, value }
        setFullAccessPending(undefined)
        setConfigPending(confirm ? change : undefined)
        if (!confirm) applyConfig(change)
      }
      const items =
        option.type === 'boolean'
          ? [true, false].map((value) => ({
              value,
              name: t(value ? 'common.enabled' : 'common.disabled'),
              confirm: value === option.confirmationValue
            }))
          : option.options
              .flatMap((choice) =>
                'group' in choice
                  ? choice.options.map((item) => ({
                      ...item,
                      description: item.description ? `${choice.name} · ${item.description}` : choice.name
                    }))
                  : [choice]
              )
              .filter(
                (choice) => option.role !== 'mode' || !choice.permissionMode || choice.permissionMode === 'default'
              )
              .map((choice) => ({ ...choice, confirm: requiresPermissionConfirmation(choice) }))
      if (items.length < 2) continue
      const menu: ComposerToolLauncher = {
        id: `local-option:${option.id}`,
        kind: 'group',
        label: option.name,
        description: option.description ?? undefined,
        suffix: items.find(({ value }) => value === option.currentValue)?.name,
        icon: null,
        submenu: items.map((item) => ({
          id: `local-option:${option.id}:${item.value}`,
          kind: 'command' as const,
          label: item.name,
          description: 'description' in item ? (item.description ?? undefined) : undefined,
          icon: null,
          active: item.value === option.currentValue,
          disabled: isDisabled,
          disabledReason,
          action: () => choose(item.value, item.confirm)
        }))
      }
      const target = option.role === 'security' ? security : session
      target.push(menu)
    }
    return { security, session }
  }, [applyConfig, disabledReason, isDisabled, localPermission?.options, presetId, t])
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
    if (
      isLocal &&
      !connectionStatus &&
      !unifiedLocalMode &&
      !configMenus.security.length &&
      !configMenus.session.length
    )
      return
    return launcher.registerLaunchers([
      ...(!isLocal || connectionStatus || unifiedLocalMode || configMenus.security.length
        ? [
            {
              ...PERMISSION_MODE_TOOLBAR_MANIFEST.toolbar,
              sources: ['popover'] as const,
              label: launcherLabel,
              description: tooltipTitle,
              tooltip: launcherTooltip,
              searchAliases: getQuickPanelSearchAliases(t, 'agent.settings.permissionMode.title'),
              icon: connectionStatus ? (
                <Shield size={18} className="text-muted-foreground" />
              ) : (
                <PermissionModeIcon mode={currentMode} />
              ),
              submenu: connectionStatus
                ? [
                    {
                      id: 'permission-connection-status',
                      kind: 'command' as const,
                      label: connectionStatus,
                      icon: null,
                      disabled: true
                    }
                  ]
                : [...modeSubmenu, ...configMenus.security]
            }
          ]
        : []),
      ...(configMenus.session.length
        ? [
            {
              id: 'local-session-options',
              kind: 'group' as const,
              sources: ['root-panel'] as const,
              rootPanelPlacement: 'trailing' as const,
              label: t('local_agents.configuration'),
              icon: <Settings2 size={16} />,
              submenu: configMenus.session
            }
          ]
        : []),
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
    configMenus,
    connectionStatus,
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
    configPending,
    setConfigPending,
    applyConfig,
    localHost,
    agentName: agent?.name.trim() || undefined
  }
}

const PermissionModeComposerRuntime = ({ context }: { context: PermissionModeContext }) => {
  const { t } = context
  const {
    fullAccessPending,
    setFullAccessPending,
    applyMode,
    configPending,
    setConfigPending,
    applyConfig,
    agentName,
    localHost
  } = usePermissionModeToolController(context)

  return (
    <FullAccessConfirmDialog
      open={Boolean(fullAccessPending || configPending)}
      onOpenChange={(open) => {
        if (!open) {
          setFullAccessPending(undefined)
          setConfigPending(undefined)
        }
      }}
      onConfirm={() =>
        configPending ? applyConfig(configPending) : !!fullAccessPending && applyMode(fullAccessPending)
      }
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
    !!session &&
    (session.agentType !== 'local' ||
      !!session.localPermission?.unavailable ||
      isUnifiedLocalPermissionMode(session.localPermission?.mode) ||
      !!session.localPermission?.options?.length),

  composer: {
    runtime: ({ context }) => <PermissionModeComposerRuntime context={context} />
  }
})

export default permissionModeTool
