import { useWebSearchProviders } from '@renderer/hooks/useWebSearch'
import type { FC } from 'react'

import { WebSearchProviderPanel } from './components/WebSearchProviderPanel'
import type { WebSearchProviderMenuEntry } from './utils/webSearchProviderMeta'

interface Props {
  entry: WebSearchProviderMenuEntry
}

const WebSearchProviderSetting: FC<Props> = ({ entry }) => {
  const {
    defaultFetchUrlsProvider,
    defaultSearchKeywordsProvider: defaultProvider,
    setDefaultFetchUrlsProvider,
    setDefaultSearchKeywordsProvider,
    updateProvider
  } = useWebSearchProviders()
  const { capability, provider } = entry

  return (
    <WebSearchProviderPanel
      provider={provider}
      capability={capability}
      defaultProvider={capability === 'fetchUrls' ? defaultFetchUrlsProvider : defaultProvider}
      setDefaultProvider={capability === 'fetchUrls' ? setDefaultFetchUrlsProvider : setDefaultSearchKeywordsProvider}
      updateProvider={updateProvider}
    />
  )
}

export default WebSearchProviderSetting
