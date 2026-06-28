import { EmptyState, ReorderableList } from '@cherrystudio/ui'
import type { CliProviderConfig } from '@shared/data/preference/preferenceTypes'
import type { Provider } from '@shared/data/types/provider'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import { ProviderCard } from './ConfigCard'

export interface ConfigListProps {
  providers: Provider[]
  providerConfigs: Record<string, CliProviderConfig>
  currentProviderId: string | null
  resolveMeta: (provider: Provider, cfg?: CliProviderConfig) => { providerName: string; modelName?: string }
  onConfigure: (provider: Provider) => void
  onToggleCurrent: (provider: Provider) => void
  onReorder: (nextProviders: Provider[]) => void | Promise<void>
}

/** Enabled-provider list for a tool. Drag a row to reorder (persisted via
 * `onReorder`); empty-state fallback when no provider matches the tool. */
export const ConfigList: FC<ConfigListProps> = ({
  providers,
  providerConfigs,
  currentProviderId,
  resolveMeta,
  onConfigure,
  onToggleCurrent,
  onReorder
}) => {
  const { t } = useTranslation()

  if (providers.length === 0) {
    return (
      <EmptyState
        preset="no-code-tool"
        title={t('code.no_providers_title')}
        description={t('code.no_providers_description')}
      />
    )
  }

  return (
    <ReorderableList
      items={providers}
      getId={(p) => p.id}
      onReorder={onReorder}
      gap="1px"
      renderItem={(provider, _index, { dragging }) => {
        const cfg = providerConfigs[provider.id]
        const meta = resolveMeta(provider, cfg)
        return (
          <ProviderCard
            provider={provider}
            providerName={meta.providerName}
            providerConfig={cfg}
            modelName={meta.modelName}
            isCurrent={currentProviderId === provider.id}
            dragging={dragging}
            onConfigure={onConfigure}
            onToggleCurrent={onToggleCurrent}
          />
        )
      }}
    />
  )
}
