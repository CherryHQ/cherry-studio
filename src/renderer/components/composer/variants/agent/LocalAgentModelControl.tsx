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
import { getLocalAgentProtocol, type LocalAgentSessionInfo } from '@shared/ai/localAgent'
import type { AgentEntity } from '@shared/data/types/agent'

import {
  COMPOSER_BELOW_SELECTOR_BUTTON_CLASS,
  COMPOSER_ICON_ONLY_LABEL_CLASS,
  COMPOSER_ICON_ONLY_SELECTOR_BUTTON_CLASS,
  COMPOSER_SELECTOR_BUTTON_CLASS
} from '../shared/ComposerControlScaffolding'

type LocalAgentModelControlProps = {
  agent: AgentEntity
  info?: LocalAgentSessionInfo | null
  sessionId?: string
  disabled: boolean
  side: 'top' | 'bottom'
  iconOnly?: boolean
}
export function LocalAgentModelControl({
  agent,
  info,
  sessionId,
  disabled,
  side,
  iconOnly = false
}: LocalAgentModelControlProps) {
  const { t } = useTranslation()
  const [saving, setSaving] = useState(false)
  const config = agent.configuration?.localRuntime
  const { catalog, freshCatalog, loading, refreshError, refresh } = useLocalAgentModelCatalog(
    config?.presetId ?? agent.id,
    config,
    false
  )
  const isQwen = config?.presetId === qwenPreset.id
  const status = info?.modelSelection
  const sessionPicker =
    !!info && getLocalAgentProtocol(config?.presetId) === 'acp' && !(isQwen && status === 'current-only')
  const catalogModels = (freshCatalog ?? catalog)?.models ?? []
  const liveModels = isQwen ? undefined : info?.models
  let nativeModels = sessionPicker ? info.models : catalogModels
  if (!sessionPicker && liveModels?.length) {
    const catalogById = new Map(catalogModels.map((model) => [model.id, model]))
    nativeModels = liveModels.map((model) => {
      const entry = catalogById.get(model.id)
      return entry ? { ...entry, ...model, registryModel: entry.registryModel ?? model.registryModel } : model
    })
  }
  const gatewayAlias =
    isQwen && config.sourceModelViaGateway && config.sourceModelId && config.nativeModel
      ? qwenPreset.catalogId(config.nativeModel)
      : undefined
  const selection = useLocalAgentModelSelection(
    config,
    gatewayAlias ? nativeModels.filter(({ id }) => id !== gatewayAlias) : nativeModels,
    sessionPicker ? info.activeModel?.id : undefined
  )
  const { models } = selection
  const activeModel = sessionPicker ? info.activeModel : undefined
  const activeGateway =
    config?.sourceModelViaGateway &&
    config.sourceModelId &&
    (!activeModel || !config.nativeModel || activeModel.id === config.nativeModel || activeModel.id === gatewayAlias)
  const value = sessionPicker && !activeGateway && !selection.activeGatewayModel ? activeModel?.id : selection.value
  const followCliLabel = sessionPicker ? undefined : selection.followCliLabel
  const selectedModel = models.find(({ id }) => id === value)
  const label = selectedModel?.name || activeModel?.name || value || followCliLabel || t('button.select_model')
  const nativeRestriction = sessionPicker
    ? status === 'selectable'
      ? undefined
      : status === 'current-only'
        ? t('local_agents.session_model.current_only')
        : status === 'sign-in-required'
          ? t('local_agents.sign_in_required')
          : status === 'empty'
            ? t('local_agents.models_unavailable')
            : t('local_agents.session_model.unsupported')
    : selection.sourceRestrictions?.native
  const footer = nativeRestriction ?? (info?.resume === false ? t('local_agents.no_resume') : undefined)

  async function selectModel(modelId?: string) {
    if (!config || disabled || saving) return false
    setSaving(true)
    try {
      if (sessionPicker && models.find(({ id }) => id === modelId)?.source !== 'gateway') {
        if (!sessionId || !modelId || status !== 'selectable') return false
        await ipcApi.request('ai.local_agents.select_session_model', { sessionId, modelId })
        return true
      }
      return !!(await selection.select(agent, modelId))
    } catch (error) {
      toast.error(String(error))
      return false
    } finally {
      setSaving(false)
    }
  }

  if (!config) return null
  return (
    <LocalAgentModelSelector
      models={models}
      presetId={config.presetId}
      sourceRestrictions={{ ...selection.sourceRestrictions, native: nativeRestriction }}
      followCliLabel={followCliLabel}
      value={value}
      disabled={disabled || saving}
      loading={!sessionPicker && loading}
      loaded={sessionPicker || !!freshCatalog || !!liveModels?.some((model) => model.registryModel)}
      error={sessionPicker ? undefined : refreshError}
      onOpenSettings={() => openRoute('/settings/local-agents', { id: config.presetId ?? agent.id })}
      side={side}
      onLoad={() => refresh().catch(() => {})}
      onSelect={selectModel}
      footer={footer && <p className="text-xs text-muted-foreground">{footer}</p>}
      trigger={
        <ModelControlButton
          model={selectedModel ?? (value ? { id: value, name: label } : undefined)}
          presetId={config.presetId}
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
