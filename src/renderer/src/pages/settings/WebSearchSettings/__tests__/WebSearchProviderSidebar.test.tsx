import '@testing-library/jest-dom/vitest'

import type { ResolvedWebSearchProvider } from '@shared/data/types/webSearch'
import { fireEvent, render, screen } from '@testing-library/react'
import type * as ReactI18next from 'react-i18next'
import { describe, expect, it, vi } from 'vitest'

import { WebSearchProviderSidebar } from '../components/WebSearchProviderSidebar'
import { getWebSearchFeatureSections } from '../utils/webSearchProviderMeta'

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactI18next>()

  return {
    ...actual,
    useTranslation: () => ({ t: (key: string) => key })
  }
})

vi.mock('../components/WebSearchProviderLogo', () => ({
  default: ({ providerName }: { providerName: string }) => <span aria-label={`${providerName} logo`} />
}))

const providers: ResolvedWebSearchProvider[] = [
  {
    id: 'tavily',
    name: 'Tavily',
    type: 'api',
    apiKeys: [],
    capabilities: [{ feature: 'searchKeywords', apiHost: 'https://api.tavily.com' }],
    engines: [],
    basicAuthUsername: '',
    basicAuthPassword: ''
  },
  {
    id: 'jina',
    name: 'Jina',
    type: 'api',
    apiKeys: [],
    capabilities: [
      { feature: 'searchKeywords', apiHost: 'https://s.jina.ai' },
      { feature: 'fetchUrls', apiHost: 'https://r.jina.ai' }
    ],
    engines: [],
    basicAuthUsername: '',
    basicAuthPassword: ''
  }
]

describe('WebSearchProviderSidebar', () => {
  it('renders capability sections and selects provider entries', () => {
    const onSelectGeneral = vi.fn()
    const onSelectProvider = vi.fn()
    const featureSections = getWebSearchFeatureSections(providers)

    render(
      <WebSearchProviderSidebar
        activeKey="fetchUrls:jina"
        featureSections={featureSections}
        defaultSearchKeywordsProviderId="tavily"
        defaultFetchUrlsProviderId="jina"
        onSelectGeneral={onSelectGeneral}
        onSelectProvider={onSelectProvider}
      />
    )

    expect(screen.getByText('settings.tool.websearch.default_provider')).toBeInTheDocument()
    expect(screen.getByText('settings.tool.websearch.fetch_urls_provider')).toBeInTheDocument()
    expect(screen.getAllByText('common.default')).toHaveLength(2)
    expect(screen.getByLabelText('Tavily logo')).toBeInTheDocument()
    expect(screen.getAllByLabelText('Jina logo')).toHaveLength(2)

    fireEvent.click(screen.getByRole('button', { name: /settings.tool.websearch.search_provider/ }))
    expect(onSelectGeneral).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getAllByRole('button', { name: /Jina/ })[1])
    expect(onSelectProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'fetchUrls:jina',
        capability: 'fetchUrls',
        provider: expect.objectContaining({ id: 'jina' })
      })
    )
  })
})
