import { SettingsContentColumn } from '@renderer/components/SettingsPrimitives'
import { useTheme } from '@renderer/hooks/useTheme'
import { useWebSearchSettings } from '@renderer/hooks/useWebSearch'
import { getWebSearchCapabilityTitleKey } from '@renderer/utils/webSearchProviderMeta'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import { WebSearchGeneralSettings } from './components/WebSearchGeneralSettings'
import { WebSearchProviderSetting } from './components/WebSearchProviderSetting'
import { useWebSearchProviderLists } from './hooks/useWebSearchProviderLists'

const webSearchFieldClassName =
  '[&_input[data-slot=input]]:h-8 [&_input[data-slot=input]]:rounded-lg [&_input[data-slot=input]]:border-border-subtle ' +
  '[&_input[data-slot=input]]:bg-muted/30 [&_input[data-slot=input]]:px-2.5 [&_input[data-slot=input]]:shadow-none ' +
  '[&_input[data-slot=input]:focus-visible]:ring-[1px] [&_input[data-slot=input]:focus-visible]:ring-ring/35 ' +
  '[&_textarea[data-slot=textarea-input]]:rounded-lg [&_textarea[data-slot=textarea-input]]:border-border-subtle ' +
  '[&_textarea[data-slot=textarea-input]]:bg-muted/30 [&_textarea[data-slot=textarea-input]]:shadow-none ' +
  '[&_textarea[data-slot=textarea-input]:focus-visible]:ring-[1px] ' +
  '[&_textarea[data-slot=textarea-input]:focus-visible]:ring-ring/35'

const WebSearchSettings: FC = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const { searchClientToolsPreferred, fetchClientToolsPreferred } = useWebSearchSettings()
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
    <SettingsContentColumn theme={theme} innerClassName={webSearchFieldClassName}>
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
        const clientToolsPreferred =
          section.capability === 'fetchUrls' ? fetchClientToolsPreferred : searchClientToolsPreferred
        const sourcePolicySummary = t(
          clientToolsPreferred
            ? 'settings.tool.websearch.source_policy.configured_first'
            : 'settings.tool.websearch.source_policy.model_first'
        )

        return (
          <section key={section.capability} className="mt-4 first:mt-0" aria-labelledby={sectionTitleId}>
            <WebSearchProviderSetting
              key={selectedEntry.key}
              entry={selectedEntry}
              entries={section.entries}
              providerOverrides={providerOverrides}
              sectionTitle={sectionTitle}
              sectionTitleId={sectionTitleId}
              sourcePolicySummary={sourcePolicySummary}
              onSetApiKeys={setApiKeys}
              onSetBasicAuth={setBasicAuth}
              onSetCapabilityApiHost={setCapabilityApiHost}
              onSetDefaultProvider={
                section.capability === 'fetchUrls' ? setDefaultFetchUrlsProvider : setDefaultSearchKeywordsProvider
              }
              onUpdateProvider={updateProvider}>
              <WebSearchGeneralSettings capability={section.capability} variant="plain" />
            </WebSearchProviderSetting>
          </section>
        )
      })}
    </SettingsContentColumn>
  )
}

export default WebSearchSettings
