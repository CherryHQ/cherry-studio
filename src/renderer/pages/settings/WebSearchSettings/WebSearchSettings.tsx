import { SettingsContentColumn } from '@renderer/components/SettingsPrimitives'
import { useTheme } from '@renderer/hooks/useTheme'
import { getWebSearchCapabilityTitleKey } from '@renderer/utils/webSearchProviderMeta'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import { ToolSourceSettings } from './components/ToolSourceSettings'
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
      <ToolSourceSettings />
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
              onUpdateProvider={updateProvider}>
              {section.capability === 'searchKeywords' ? <WebSearchGeneralSettings variant="plain" /> : null}
            </WebSearchProviderSetting>
          </section>
        )
      })}
    </SettingsContentColumn>
  )
}

export default WebSearchSettings
