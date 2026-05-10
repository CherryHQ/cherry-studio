import type { FC } from 'react'
import { useEffect, useMemo, useState } from 'react'

import { WebSearchProviderSidebar } from './components/WebSearchProviderSidebar'
import { WebSearchSettingsLayout } from './components/WebSearchSettingsLayout'
import { useWebSearchProviderLists } from './hooks/useWebSearchProviderLists'
import WebSearchGeneralSettings from './WebSearchGeneralSettings'
import WebSearchProviderSetting from './WebSearchProviderSetting'

const WebSearchSettings: FC = () => {
  const { defaultFetchUrlsProvider, defaultSearchKeywordsProvider, featureSections } = useWebSearchProviderLists()
  const [activeKey, setActiveKey] = useState('general')
  const activeEntry = useMemo(
    () => featureSections.flatMap((section) => section.entries).find((entry) => entry.key === activeKey),
    [activeKey, featureSections]
  )

  useEffect(() => {
    if (activeKey !== 'general' && !activeEntry) {
      setActiveKey('general')
    }
  }, [activeEntry, activeKey])

  return (
    <WebSearchSettingsLayout
      sidebar={
        <WebSearchProviderSidebar
          activeKey={activeKey}
          defaultFetchUrlsProviderId={defaultFetchUrlsProvider?.id}
          defaultSearchKeywordsProviderId={defaultSearchKeywordsProvider?.id}
          featureSections={featureSections}
          onSelectGeneral={() => setActiveKey('general')}
          onSelectProvider={(entry) => setActiveKey(entry.key)}
        />
      }>
      {activeEntry ? <WebSearchProviderSetting entry={activeEntry} /> : <WebSearchGeneralSettings />}
    </WebSearchSettingsLayout>
  )
}

export default WebSearchSettings
