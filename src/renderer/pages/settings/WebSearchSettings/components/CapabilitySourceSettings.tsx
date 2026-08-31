import { Switch } from '@cherrystudio/ui'
import { SettingGroup, SettingHelpText, SettingRow, SettingRowTitle } from '@renderer/components/SettingsPrimitives'
import { useWebSearchSettings } from '@renderer/hooks/useWebSearch'
import type { WebSearchCapability } from '@shared/data/preference/preferenceTypes'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import { useWebSearchPersist } from '../hooks/useWebSearchPersist'

export const CapabilitySourceSettings: FC<{ capability: WebSearchCapability }> = ({ capability }) => {
  const { t } = useTranslation()
  const {
    searchClientToolsPreferred,
    fetchClientToolsPreferred,
    setSearchClientToolsPreferred,
    setFetchClientToolsPreferred
  } = useWebSearchSettings()
  const persist = useWebSearchPersist()
  const isSearch = capability === 'searchKeywords'
  const labelKey = isSearch
    ? 'settings.tool.websearch.search_client_tools_preferred.label'
    : 'settings.tool.websearch.fetch_client_tools_preferred.label'
  const descriptionKey = isSearch
    ? 'settings.tool.websearch.search_client_tools_preferred.description'
    : 'settings.tool.websearch.fetch_client_tools_preferred.description'
  const checked = isSearch ? searchClientToolsPreferred : fetchClientToolsPreferred
  const setChecked = isSearch ? setSearchClientToolsPreferred : setFetchClientToolsPreferred

  return (
    <SettingGroup variant="plain">
      <SettingRow className="min-h-8 items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <SettingRowTitle>{t(labelKey)}</SettingRowTitle>
          <SettingHelpText className="mt-1">{t(descriptionKey)}</SettingHelpText>
        </div>
        <Switch
          aria-label={t(labelKey)}
          checked={checked}
          onCheckedChange={(value) =>
            void persist(() => setChecked(value), `Failed to save the ${capability} source preference`)
          }
        />
      </SettingRow>
    </SettingGroup>
  )
}
