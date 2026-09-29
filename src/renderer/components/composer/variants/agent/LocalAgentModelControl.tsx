import { ChevronDown, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@cherrystudio/ui'
import { CliModelAvatar } from '@renderer/components/Avatar/CliModelAvatar'
import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import { LocalAgentModelSelector } from '@renderer/components/LocalAgentModelSelector'
import { useUpdateAgent } from '@renderer/hooks/agent/useAgent'
import { ipcApi } from '@renderer/ipc'
import { openSettingsTab } from '@renderer/services/mainWindowNavigation'
import { cn } from '@renderer/utils/style'
import type { LocalAgentModelCatalog, LocalAgentSessionInfo } from '@shared/ai/localAgent'
import type { AgentEntity } from '@shared/data/types/agent'

import {
  COMPOSER_BELOW_SELECTOR_BUTTON_CLASS,
  COMPOSER_ICON_ONLY_LABEL_CLASS,
  COMPOSER_ICON_ONLY_SELECTOR_BUTTON_CLASS,
  COMPOSER_SELECTOR_BUTTON_CLASS
} from '../shared/ComposerControlScaffolding'

export function LocalAgentModelControl({
  agent,
  info,
  disabled,
  side,
  iconOnly = false
}: {
  agent: AgentEntity
  info?: LocalAgentSessionInfo | null
  disabled: boolean
  side: 'top' | 'bottom'
  iconOnly?: boolean
}) {
  const { t } = useTranslation()
  const { updateAgent } = useUpdateAgent()
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [catalog, setCatalog] = useState<{ key: string; value: LocalAgentModelCatalog }>()
  const [error, setError] = useState<string>()
  const config = agent.configuration?.localRuntime
  const catalogKey = JSON.stringify([
    config?.protocol,
    config?.presetId,
    config?.executableOverride,
    config?.args,
    config?.env
  ])
  const models = catalog?.key === catalogKey ? catalog.value.models : (info?.models ?? [])
  const label = config?.nativeModel
    ? models.find((model) => model.id === config.nativeModel)?.name || config.nativeModel
    : t('local_agents.follow_cli')

  const selectedModel = config?.nativeModel ? { id: config.nativeModel, name: label } : undefined

  const loadModels = async () => {
    if (!config || loading) return
    setLoading(true)
    setError(undefined)
    try {
      const value = await ipcApi.request('ai.local_agents.models', config)
      setCatalog({ key: catalogKey, value })
    } catch (error) {
      setError(String(error))
    } finally {
      setLoading(false)
    }
  }
  const selectModel = async (nativeModel?: string) => {
    if (!config || disabled || saving) return false
    if (nativeModel === config.nativeModel) return true
    setSaving(true)
    setError(undefined)
    try {
      await updateAgent({ id: agent.id, configuration: { localRuntime: { ...config, nativeModel } } })
      return true
    } catch (error) {
      setError(String(error))
      return false
    } finally {
      setSaving(false)
    }
  }
  if (!config) return null
  return (
    <LocalAgentModelSelector
      models={models}
      value={config.nativeModel}
      disabled={disabled || saving}
      loading={loading}
      loaded={catalog?.key === catalogKey || models.length > 0}
      error={error}
      onOpenSettings={() =>
        openSettingsTab(`/settings/local-agents?id=${encodeURIComponent(config.presetId ?? agent.id)}`)
      }
      side={side}
      onLoad={loadModels}
      onSelect={selectModel}
      footer={
        info?.resume === false ? (
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
