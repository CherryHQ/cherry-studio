import { SettingsContentColumn } from '@renderer/components/SettingsPrimitives'
import { useTheme } from '@renderer/hooks/useTheme'
import { getWebSearchCapabilityTitleKey } from '@renderer/utils/webSearchProviderMeta'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import { WebSearchGeneralSettings } from './components/WebSearchGeneralSettings'
import { WebSearchProviderSetting } from './components/WebSearchProviderSetting'
import { useWebSearchProviderLists } from './hooks/useWebSearchProviderLists'

const WebSearchSettings: FC = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const {
    defaultFetchUrlsProvider,
    defaultSearchKeywordsProvider,
    featureSections,
    providerOverrides,
    setApiKeys,
    setBasicAuth,
    setCapabilityApiHost,
    setDefaultFetchUrlsProvider,
    setDefaultSearchKeywordsProvider,
    updateProvider
  } = useWebSearchProviderLists()

  return (
    <SettingsContentColumn theme={theme}>
      {featureSections.map((section) => {
        const defaultProvider =
          section.capability === 'fetchUrls' ? defaultFetchUrlsProvider : defaultSearchKeywordsProvider
        const selectedEntry =
          section.entries.find((entry) => entry.provider.id === defaultProvider?.id) ?? section.entries[0]

        if (!selectedEntry) {
          return null
        }

        const sectionTitle = t(getWebSearchCapabilityTitleKey(section.capability))
        const sectionTitleId = `web-search-${section.capability}-title`

        return (
          <section key={section.capability} className="mt-4 first:mt-0" aria-labelledby={sectionTitleId}>
            <WebSearchProviderSetting
              key={selectedEntry.key}
              entry={selectedEntry}
              entries={section.entries}
              providerOverrides={providerOverrides}
              sectionTitle={sectionTitle}
              sectionTitleId={sectionTitleId}
              onSetApiKeys={setApiKeys}
              onSetBasicAuth={setBasicAuth}
              onSetCapabilityApiHost={setCapabilityApiHost}
              onSetDefaultProvider={
                section.capability === 'fetchUrls' ? setDefaultFetchUrlsProvider : setDefaultSearchKeywordsProvider
              }
              onUpdateProvider={updateProvider}
            />
          </section>
        )
      })}
      <WebSearchGeneralSettings />
    </SettingsContentColumn>
  )
}

export default WebSearchSettings
