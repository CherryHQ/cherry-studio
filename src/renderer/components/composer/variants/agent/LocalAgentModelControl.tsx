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
import { LocalAgentConfigControl } from './LocalAgentConfigControl'

type LocalAgentModelControlProps = {
  agent: AgentEntity
  info?: LocalAgentSessionInfo | null
  sessionId?: string
  disabled: boolean
  side: 'top' | 'bottom'
  iconOnly?: boolean
}
export function LocalAgentModelControl(props: LocalAgentModelControlProps) {
  const config = props.agent.configuration?.localRuntime
  if (!config) return null
  if (config.presetId === qwenPreset.id && (!props.info || props.info.modelSelection === 'current-only')) {
    return <NativeModelControl {...props} />
  }
  return getLocalAgentProtocol(config.presetId) === 'acp' ? (
    <AcpSessionModelControl {...props} />
  ) : (
    <NativeModelControl {...props} />
  )
}

function AcpSessionModelControl({
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
  const { refresh, refreshError, loading } = useLocalAgentModelCatalog(config?.presetId ?? agent.id, config, false)
  const status = info?.modelSelection
  const models = (info?.models ?? []).map((model) => ({ ...model, source: 'native' as const }))
  const value = info?.activeModel?.id
  const model = models.find(({ id }) => id === value) ?? info?.activeModel
  const options = info?.configOptions?.filter((option) => option.category === 'model_config')
  const label = model?.name || value || config?.nativeModel || t('button.select_model')
  const footer =
    status === 'current-only'
      ? t('local_agents.session_model.current_only')
      : status === 'unsupported'
        ? t('local_agents.session_model.unsupported')
        : status === 'sign-in-required'
          ? t('local_agents.sign_in_required')
          : !info && !refreshError
            ? t('local_agents.session_model.connect')
            : undefined

  return (
    <LocalAgentModelSelector
      models={models}
      presetId={config?.presetId}
      value={value}
      disabled={!!info && (disabled || saving || status !== 'selectable')}
      loaded={!!info}
      loading={!info && loading}
      error={info ? undefined : refreshError}
      onLoad={() => refresh().catch(() => {})}
      onOpenSettings={() => openRoute('/settings/local-agents', { id: config?.presetId ?? agent.id })}
      onSelect={async (modelId) => {
        if (!modelId || !sessionId || disabled || saving || status !== 'selectable') return false
        setSaving(true)
        try {
          await ipcApi.request('ai.local_agents.select_session_model', { sessionId, modelId })
          return true
        } catch (error) {
          toast.error(String(error))
          return false
        } finally {
          setSaving(false)
        }
      }}
      side={side}
      configuration={
        sessionId && !!options?.length ? (
          <LocalAgentConfigControl
            sessionId={sessionId}
            presetId={config?.presetId}
            options={options}
            side="bottom"
            disabled={disabled || saving}
          />
        ) : undefined
      }
      footer={footer && <p className="text-muted-foreground">{footer}</p>}
      trigger={
        <ModelControlButton
          model={model && { ...model, name: label }}
          presetId={config?.presetId}
          label={label}
          disabled={disabled || saving}
          saving={saving}
          side={side}
          iconOnly={iconOnly}
        />
      }
    />
  )
}

function NativeModelControl({ agent, info, sessionId, disabled, side, iconOnly = false }: LocalAgentModelControlProps) {
  const { t } = useTranslation()
  const [saving, setSaving] = useState(false)
  const config = agent.configuration?.localRuntime
  const { catalog, freshCatalog, loading, refreshError, refresh } = useLocalAgentModelCatalog(
    config?.presetId ?? agent.id,
    config,
    false
  )
  const isQwen = config?.presetId === qwenPreset.id
  const liveModels = isQwen ? undefined : info?.models
  const catalogModels = (freshCatalog ?? catalog)?.models ?? []
  const catalogById = new Map(catalogModels.map((model) => [model.id, model]))
  const nativeModels = liveModels?.length
    ? liveModels.map((model) => {
        const entry = catalogById.get(model.id)
        return entry ? { ...entry, ...model, registryModel: entry.registryModel ?? model.registryModel } : model
      })
    : catalogModels
  const qwenGatewayAlias =
    isQwen && config.sourceModelViaGateway && config.sourceModelId && config.nativeModel
      ? qwenPreset.catalogId(config.nativeModel)
      : undefined
  const selection = useLocalAgentModelSelection(
    config,
    qwenGatewayAlias ? nativeModels.filter(({ id }) => id !== qwenGatewayAlias) : nativeModels
  )
  const { models, value } = selection
  const modelConfigOptions = info?.configOptions?.filter((option) => option.category === 'model_config')
  const label = value
    ? models.find((model) => model.id === value)?.name || value
    : (selection.followCliLabel ?? t('button.select_model'))

  const selectedModelId = value
  const selectedModel = selectedModelId
    ? (models.find((model) => model.id === selectedModelId) ?? { id: selectedModelId, name: label })
    : undefined

  const loadModels = () => refresh().catch(() => {})
  const selectModel = async (nativeModel?: string) => {
    if (!config || disabled || saving) return false
    setSaving(true)
    try {
      const updated = await selection.select(agent, nativeModel)
      return !!updated
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
      sourceRestrictions={selection.sourceRestrictions}
      followCliLabel={selection.followCliLabel}
      value={value}
      disabled={disabled || saving}
      loading={loading}
      loaded={!!freshCatalog || !!liveModels?.some((model) => model.registryModel)}
      error={refreshError}
      onOpenSettings={() => openRoute('/settings/local-agents', { id: config.presetId ?? agent.id })}
      side={side}
      onLoad={loadModels}
      onSelect={selectModel}
      configuration={
        sessionId && !!modelConfigOptions?.length ? (
          <LocalAgentConfigControl
            sessionId={sessionId}
            presetId={config.presetId}
            options={modelConfigOptions}
            side="bottom"
            disabled={disabled || saving || !info}
          />
        ) : undefined
      }
      footer={
        selection.sourceRestrictions?.native ? (
          <p className="text-xs text-muted-foreground">{t('local_agents.global_model_unavailable')}</p>
        ) : info?.resume === false ? (
          <p className="text-xs text-muted-foreground">{t('local_agents.no_resume')}</p>
        ) : isQwen ? (
          <p className="text-xs text-muted-foreground">{t('settings.model')}</p>
        ) : undefined
      }
      trigger={
        <ModelControlButton
          model={selectedModel}
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
        iconOnly && COMPOSER_ICON_ONLY_SELECTOR_BUTTON_CLASS
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
