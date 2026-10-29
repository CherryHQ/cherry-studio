import { useSearch } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { MemoryEditor } from '@renderer/components/memory/MemoryEditor'
import { SettingsContentColumn } from '@renderer/components/SettingsPrimitives'
import { useQuery } from '@renderer/data/hooks/useDataApi'

export function MemorySettings() {
  const { t } = useTranslation()
  const { agentId } = useSearch({ from: '/settings/memory' })
  const { data: agent } = useQuery('/agents/:agentId', { params: { agentId: agentId ?? '' }, enabled: !!agentId })
  return (
    <SettingsContentColumn>
      <div className="space-y-4">
        <h2 className="font-semibold">
          {t(agentId ? 'settings.memory.private' : 'settings.memory.title')}
          {agent ? ` · ${agent.name}` : ''}
        </h2>
        <MemoryEditor key={agentId ?? 'shared'} scope={agentId ? { kind: 'private', agentId } : { kind: 'shared' }} />
      </div>
    </SettingsContentColumn>
  )
}
