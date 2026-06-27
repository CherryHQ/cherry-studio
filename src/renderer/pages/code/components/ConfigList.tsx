import { EmptyState } from '@cherrystudio/ui'
import type { CliNamedConfig } from '@shared/data/preference/preferenceTypes'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import { ConfigCard } from './ConfigCard'

export interface ConfigListProps {
  configs: CliNamedConfig[]
  currentConfigId: string | null
  resolveMeta: (config: CliNamedConfig) => { providerName?: string; modelName?: string }
  onEdit: (config: CliNamedConfig) => void
  onDelete: (config: CliNamedConfig) => void
  onToggleCurrent: (config: CliNamedConfig) => void
}

/** Named-config list for a tool, with an empty-state fallback. */
export const ConfigList: FC<ConfigListProps> = ({
  configs,
  currentConfigId,
  resolveMeta,
  onEdit,
  onDelete,
  onToggleCurrent
}) => {
  const { t } = useTranslation()

  if (configs.length === 0) {
    return (
      <EmptyState
        preset="no-code-tool"
        title={t('code.no_configs_title')}
        description={t('code.no_configs_description')}
      />
    )
  }

  return (
    <div className="space-y-[1px]">
      {configs.map((config) => {
        const meta = resolveMeta(config)
        return (
          <ConfigCard
            key={config.id}
            config={config}
            providerName={meta.providerName}
            modelName={meta.modelName}
            isCurrent={currentConfigId === config.id}
            onEdit={onEdit}
            onDelete={onDelete}
            onToggleCurrent={onToggleCurrent}
          />
        )
      })}
    </div>
  )
}
