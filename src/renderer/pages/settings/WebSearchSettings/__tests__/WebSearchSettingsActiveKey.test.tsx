import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import type * as ReactI18next from 'react-i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import WebSearchSettings from '../WebSearchSettings'

const useWebSearchProviderListsMock = vi.fn()

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactI18next>()

  return {
    ...actual,
    useTranslation: () => ({ t: (key: string) => key })
  }
})

vi.mock('../components/WebSearchGeneralSettings', () => ({
  WebSearchGeneralSettings: () => <div>general-settings</div>
}))

vi.mock('../components/WebSearchProviderSetting', () => ({
  WebSearchProviderSetting: ({ children, entry }: { children?: ReactNode; entry: { provider: { name: string } } }) => (
    <div>
      {entry.provider.name} provider-settings
      {children}
    </div>
  )
}))

vi.mock('../hooks/useWebSearchProviderLists', () => ({
  useWebSearchProviderLists: () => useWebSearchProviderListsMock()
}))

const tavilyEntry = {
  key: 'searchKeywords:tavily',
  capability: 'searchKeywords' as const,
  provider: {
    id: 'tavily',
    name: 'Tavily',
    type: 'api' as const,
    apiKeys: [],
    capabilities: [{ feature: 'searchKeywords' as const, apiHost: 'https://api.tavily.com' }],
    engines: [],
    basicAuthUsername: '',
    basicAuthPassword: ''
  },
  providerCapability: { feature: 'searchKeywords' as const, apiHost: 'https://api.tavily.com' }
}

const exaEntry = {
  key: 'searchKeywords:exa',
  capability: 'searchKeywords' as const,
  provider: {
    ...tavilyEntry.provider,
    id: 'exa',
    name: 'Exa'
  },
  providerCapability: { feature: 'searchKeywords' as const, apiHost: 'https://api.exa.ai' }
}

function mockProviderLists(
  featureSections = [{ capability: 'searchKeywords' as const, entries: [tavilyEntry, exaEntry] }],
  defaultSearchKeywordsProvider = tavilyEntry.provider
) {
  useWebSearchProviderListsMock.mockReturnValue({
    defaultFetchUrlsProvider: undefined,
    defaultSearchKeywordsProvider,
    featureSections,
    providerOverrides: {},
    setApiKeys: vi.fn(),
    setBasicAuth: vi.fn(),
    setCapabilityApiHost: vi.fn(),
    setDefaultFetchUrlsProvider: vi.fn(),
    setDefaultSearchKeywordsProvider: vi.fn(),
    updateProvider: vi.fn()
  })
}

describe('WebSearchSettings default provider selection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockProviderLists()
  })

  it('falls back to the first provider when the default entry disappears', () => {
    mockProviderLists(undefined, exaEntry.provider)
    const { rerender } = render(<WebSearchSettings />)

    expect(screen.getByText('Exa provider-settings')).toBeInTheDocument()

    mockProviderLists([{ capability: 'searchKeywords', entries: [tavilyEntry] }], exaEntry.provider)
    rerender(<WebSearchSettings />)

    expect(screen.getByText('Tavily provider-settings')).toBeInTheDocument()
    expect(screen.getByText('general-settings')).toBeInTheDocument()
  })
})
