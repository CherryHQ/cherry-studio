import { Info } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { NormalTooltip, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@cherrystudio/ui'
import { useUpdateAgent } from '@renderer/hooks/agent/useAgent'
import { toast } from '@renderer/services/toast'
import type { LocalAgentSessionInfo } from '@shared/ai/localAgent'
import type { AgentEntity } from '@shared/data/types/agent'

export function LocalAgentModelControl({
  agent,
  info,
  disabled
}: {
  agent: AgentEntity
  info: LocalAgentSessionInfo | null
  disabled: boolean
}) {
  const { t } = useTranslation()
  const { updateAgent } = useUpdateAgent()
  const [saving, setSaving] = useState(false)
  const config = agent.configuration?.localRuntime
  if (!config || !info) return null
  if (!info.resume)
    return (
      <NormalTooltip content={t('local_agents.no_resume')}>
        <span aria-label={t('local_agents.no_resume')} className="text-muted-foreground">
          <Info size={16} />
        </span>
      </NormalTooltip>
    )
  if (!info.models.length) return null
  return (
    <Select
      value={config.nativeModel ?? '__cli_default__'}
      disabled={disabled || saving}
      onValueChange={async (value) => {
        setSaving(true)
        try {
          await updateAgent({
            id: agent.id,
            configuration: { localRuntime: { ...config, nativeModel: value === '__cli_default__' ? undefined : value } }
          })
        } catch (error) {
          toast.error(String(error))
        } finally {
          setSaving(false)
        }
      }}>
      <SelectTrigger className="h-7 max-w-48 text-xs" aria-label={t('button.select_model')}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__cli_default__">{t('local_agents.follow_cli')}</SelectItem>
        {info.models.map((model) => (
          <SelectItem key={model.id} value={model.id}>
            {model.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
