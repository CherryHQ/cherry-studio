import { ChevronDown, Loader2 } from 'lucide-react'
import { type ComponentProps, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { qwenPreset } from '@cherrystudio/agent-runtime-qwen-acp'
import { Button } from '@cherrystudio/ui'
import { LocalAgentModelAvatar } from '@renderer/components/localAgent/LocalAgentModelAvatar'
import { LocalAgentModelSelector } from '@renderer/components/LocalAgentModelSelector'
import { useLocalAgentModelCatalog } from '@renderer/hooks/agent/useLocalAgentModelCatalog'
import { useLocalAgentModelSelection } from '@renderer/hooks/agent/useLocalAgentModelSelection'
import { ipcApi } from '@renderer/ipc'
import { openRoute } from '@renderer/services/mainWindowNavigation'
import { toast } from '@renderer/services/toast'
import { cn } from '@renderer/utils/style'
import { getLocalAgentProtocol, type LocalAgentSessionInfo, type LocalAgentSessionView } from '@shared/ai/localAgent'
import type { AgentEntity } from '@shared/data/types/agent'
import { parseUniqueModelId } from '@shared/data/types/model'
import { formatGatewayModelId } from '@shared/utils/apiGateway'

import {
  COMPOSER_BELOW_SELECTOR_BUTTON_CLASS,
  COMPOSER_ICON_ONLY_LABEL_CLASS,
  COMPOSER_ICON_ONLY_SELECTOR_BUTTON_CLASS,
  COMPOSER_SELECTOR_BUTTON_CLASS
} from '../shared/ComposerControlScaffolding'

type LocalAgentModelControlProps = {
  agent: AgentEntity
  info?: LocalAgentSessionInfo | null
  connecting?: boolean
  sessionId?: string
  disabled: boolean
  side: 'top' | 'bottom'
  iconOnly?: boolean
} & Pick<LocalAgentSessionView, 'providerId' | 'presetId'>
export function LocalAgentModelControl({
  agent,
  info,
  connecting,
  providerId,
  presetId: sessionPresetId,
  sessionId,
  disabled,
  side,
  iconOnly = false
}: LocalAgentModelControlProps) {
  const { t } = useTranslation()
  const [saving, setSaving] = useState(false)
  const separateProvider = !!providerId && providerId !== agent.localRuntime?.providerId
  const config = separateProvider ? undefined : agent.localRuntime
  const presetId = providerId ? sessionPresetId : config?.presetId
  const { catalog, freshCatalog, loading, refreshError, refresh } = useLocalAgentModelCatalog(
    config?.presetId ?? agent.id,
    config,
    false,
    agent
  )
  const isQwen = presetId === qwenPreset.id
  const status = info?.modelSelection
  const isAcp = getLocalAgentProtocol(presetId) === 'acp'
  const awaitingSession = (isAcp || (separateProvider && !info)) && !!sessionId && !status
  const sessionPicker = !!info && !!status && (separateProvider || (isAcp && !(isQwen && status === 'current-only')))
  const awaitingModelOptions = awaitingSession && (connecting === true || !!info)
  const catalogModels = (freshCatalog ?? catalog)?.models ?? []
  const liveModels = isQwen ? undefined : info?.models
  let nativeModels = sessionPicker ? info.models : awaitingSession ? [] : catalogModels
  if (!awaitingSession && !sessionPicker && liveModels?.length) {
    const catalogById = new Map(catalogModels.map((model) => [model.id, model]))
    nativeModels = liveModels.map((model) => {
      const entry = catalogById.get(model.id)
      return entry ? { ...entry, ...model, registryModel: entry.registryModel ?? model.registryModel } : model
    })
  }
  const selection = useLocalAgentModelSelection(config, nativeModels, sessionPicker ? info.activeModel?.id : undefined)
  const sourceModel =
    isQwen && config?.sourceModelViaGateway && config.sourceModelId
      ? parseUniqueModelId(config.sourceModelId)
      : undefined
  const gatewayOption = sourceModel && selection.models.find(({ id }) => id === selection.value)
  const gatewayAlias =
    sourceModel && !sourceModel.providerId.includes(':')
      ? qwenPreset.catalogId(
          formatGatewayModelId(sourceModel.providerId, gatewayOption?.apiModelId ?? sourceModel.modelId)
        )
      : undefined
  const models = selection.models.filter(
    ({ id, source }) => source === 'gateway' || (!awaitingSession && id !== gatewayAlias)
  )
  const activeModel = sessionPicker || separateProvider ? info?.activeModel : undefined
  const activeGateway =
    config?.sourceModelViaGateway &&
    config.sourceModelId &&
    (!activeModel || !gatewayAlias || activeModel.id === gatewayAlias)
  const value = sessionPicker && !activeGateway && !selection.activeGatewayModel ? activeModel?.id : selection.value
  const followCliLabel = sessionPicker || awaitingSession ? undefined : selection.followCliLabel
  const selectedModel = models.find(({ id }) => id === value)
  const label = selectedModel?.name || activeModel?.name || value || followCliLabel || t('button.select_model')
  const nativeRestriction = awaitingSession
    ? t(awaitingModelOptions ? 'common.loading' : 'local_agents.session_model.connect')
    : sessionPicker
      ? status === 'selectable'
        ? undefined
        : status === 'current-only'
          ? t('local_agents.session_model.current_only')
          : status === 'sign-in-required'
            ? t('local_agents.sign_in_required')
            : status === 'empty'
              ? t('local_agents.models_unavailable')
              : t('local_agents.session_model.unsupported')
      : separateProvider
        ? t('local_agents.session_model.current_only')
        : selection.sourceRestrictions?.native
  const footer = nativeRestriction ?? (info?.resume === false ? t('local_agents.no_resume') : undefined)

  async function selectModel(modelId?: string) {
    if (disabled || saving) return false
    setSaving(true)
    try {
      if (sessionPicker && !activeGateway && models.find(({ id }) => id === modelId)?.source !== 'gateway') {
        if (!sessionId || !modelId || status !== 'selectable') return false
        await ipcApi.request('ai.local_agents.select_session_model', { sessionId, modelId })
        return true
      }
      return !!config && !!(await selection.select(agent, modelId))
    } catch (error) {
      toast.error(String(error))
      return false
    } finally {
      setSaving(false)
    }
  }

  if (!agent.localRuntime) return null
  return (
    <LocalAgentModelSelector
      models={models}
      presetId={presetId}
      sourceRestrictions={{ ...selection.sourceRestrictions, native: nativeRestriction }}
      followCliLabel={followCliLabel}
      value={awaitingSession && !selectedModel ? undefined : value}
      disabled={disabled || saving}
      loading={awaitingSession ? awaitingModelOptions : !sessionPicker && loading}
      loaded={
        separateProvider ||
        awaitingSession ||
        sessionPicker ||
        !!freshCatalog ||
        !!liveModels?.some((model) => model.registryModel)
      }
      error={sessionPicker || awaitingSession ? undefined : refreshError}
      onOpenSettings={() => openRoute('/settings/local-agents', { id: agent.localRuntime?.presetId ?? agent.id })}
      side={side}
      onLoad={() => refresh().catch(() => {})}
      onSelect={selectModel}
      footer={footer && <p className="text-xs text-muted-foreground">{footer}</p>}
      trigger={
        <ModelControlButton
          model={selectedModel ?? (value ? { id: value, name: label } : undefined)}
          presetId={presetId}
          label={label}
          saving={saving}
          disabled={disabled || saving}
          side={side}
          iconOnly={iconOnly}
        />
      }
    />
  )
}

function ModelControlButton({
  model,
  presetId,
  label,
  saving,
  disabled,
  side,
  iconOnly,
  className,
  ...buttonProps
}: ComponentProps<typeof Button> & {
  model?: ComponentProps<typeof LocalAgentModelAvatar>['model']
  presetId?: string
  label: string
  saving: boolean
  disabled: boolean
  side: 'top' | 'bottom'
  iconOnly: boolean
}) {
  const { t } = useTranslation()
  return (
    <Button
      {...buttonProps}
      variant="ghost"
      size="sm"
      disabled={disabled}
      aria-label={t('button.select_model')}
      className={cn(
        side === 'bottom' ? COMPOSER_BELOW_SELECTOR_BUTTON_CLASS : COMPOSER_SELECTOR_BUTTON_CLASS,
        iconOnly && COMPOSER_ICON_ONLY_SELECTOR_BUTTON_CLASS,
        className
      )}>
      {saving ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <LocalAgentModelAvatar model={model} presetId={presetId} size={20} />
      )}
      <span title={label} className={cn('max-w-40 truncate text-xs', iconOnly && COMPOSER_ICON_ONLY_LABEL_CLASS)}>
        {label}
      </span>
      <ChevronDown size={14} className={cn('text-muted-foreground', iconOnly && 'hidden')} />
    </Button>
  )
}
