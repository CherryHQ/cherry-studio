import { ChevronDown, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@cherrystudio/ui'
import { CliModelAvatar } from '@renderer/components/Avatar/CliModelAvatar'
import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import { LocalAgentModelSelector } from '@renderer/components/LocalAgentModelSelector'
import { useLocalAgentModelCatalog } from '@renderer/hooks/agent/useLocalAgentModelCatalog'
import { useLocalAgentModelSelection } from '@renderer/hooks/agent/useLocalAgentModelSelection'
import { openRoute } from '@renderer/services/mainWindowNavigation'
import { toast } from '@renderer/services/toast'
import { cn } from '@renderer/utils/style'
import type { LocalAgentSessionInfo } from '@shared/ai/localAgent'
import { LOCAL_AGENT_MODEL_CONFIG } from '@shared/ai/localAgentModel'
import type { AgentEntity } from '@shared/data/types/agent'

import {
  COMPOSER_BELOW_SELECTOR_BUTTON_CLASS,
  COMPOSER_ICON_ONLY_LABEL_CLASS,
  COMPOSER_ICON_ONLY_SELECTOR_BUTTON_CLASS,
  COMPOSER_SELECTOR_BUTTON_CLASS
} from '../shared/ComposerControlScaffolding'
import { LocalAgentConfigControl } from './LocalAgentConfigControl'

export function LocalAgentModelControl({
  agent,
  info,
  sessionId,
  disabled,
  side,
  iconOnly = false
}: {
  agent: AgentEntity
  info?: LocalAgentSessionInfo | null
  sessionId?: string
  disabled: boolean
  side: 'top' | 'bottom'
  iconOnly?: boolean
}) {
  const { t } = useTranslation()
  const [saving, setSaving] = useState(false)
  const config = agent.configuration?.localRuntime
  const { catalog, freshCatalog, loading, refreshError, refresh } = useLocalAgentModelCatalog(
    config?.presetId ?? agent.id,
    config,
    false
  )
  const selection = useLocalAgentModelSelection(config, freshCatalog?.models ?? info?.models ?? catalog?.models ?? [])
  const { models, value } = selection
  const modelConfigOptions = info?.configOptions?.filter((option) => option.category === 'model_config')
  const label = value ? models.find((model) => model.id === value)?.name || value : t('local_agents.follow_cli')

  const selectedModel = value ? { id: value, name: label } : undefined

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
      value={value}
      disabled={disabled || saving || !LOCAL_AGENT_MODEL_CONFIG[config.presetId ?? '']}
      loading={loading}
      loaded={!!freshCatalog || !!info?.models?.length}
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
        !LOCAL_AGENT_MODEL_CONFIG[config.presetId ?? ''] ? (
          <p className="text-xs text-muted-foreground">{t('local_agents.global_model_unavailable')}</p>
        ) : info?.resume === false ? (
          <p className="text-xs text-muted-foreground">{t('local_agents.no_resume')}</p>
        ) : undefined
      }
      trigger={
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled || saving}
          aria-label={t('button.select_model')}
          className={cn(
            side === 'bottom' ? COMPOSER_BELOW_SELECTOR_BUTTON_CLASS : COMPOSER_SELECTOR_BUTTON_CLASS,
            iconOnly && COMPOSER_ICON_ONLY_SELECTOR_BUTTON_CLASS
          )}>
          {saving ? (
            <Loader2 size={20} className="animate-spin text-muted-foreground" />
          ) : selectedModel ? (
            <ModelAvatar model={selectedModel} size={20} />
          ) : (
            <CliModelAvatar />
          )}
          <span title={label} className={cn('max-w-40 truncate text-xs', iconOnly && COMPOSER_ICON_ONLY_LABEL_CLASS)}>
            {label}
          </span>
          <ChevronDown size={14} className={cn('text-muted-foreground', iconOnly && 'hidden')} />
        </Button>
      }
    />
  )
}
