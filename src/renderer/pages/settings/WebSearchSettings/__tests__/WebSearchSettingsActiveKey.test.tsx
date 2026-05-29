import '@testing-library/jest-dom/vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type * as ReactI18next from 'react-i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import WebSearchSettings from '..'

const useWebSearchProviderListsMock = vi.fn()

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactI18next>()

  return {
    ...actual,
    useTranslation: () => ({ t: (key: string) => key })
  }
})

vi.mock('@renderer/components/Scrollbar', () => ({
  default: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>
}))

vi.mock('@cherrystudio/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof CherryStudioUi>()),
  Badge: ({ children, ...props }: React.HTMLAttributes<HTMLSpanElement>) => <span {...props}>{children}</span>,
  MenuDivider: (props: React.HTMLAttributes<HTMLDivElement>) => <div role="separator" {...props} />,
  MenuItem: ({
    label,
    active,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    label: string
    active?: boolean
  }) => (
    <button type="button" data-active={active || undefined} {...props}>
      {label}
    </button>
  ),
  MenuList: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>
}))

vi.mock('../components/WebSearchGeneralSettings', () => ({
  WebSearchGeneralSettings: () => <div>general-settings</div>
}))

vi.mock('../components/WebSearchProviderLogo', () => ({
  default: ({ providerName }: { providerName: string }) => <span aria-label={`${providerName} logo`} />
}))

vi.mock('../components/WebSearchProviderSetting', () => ({
  WebSearchProviderSetting: ({ entry }: { entry: { provider: { name: string } } }) => (
    <div>{entry.provider.name} provider-settings</div>
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

function mockProviderLists(featureSections = [{ capability: 'searchKeywords' as const, entries: [tavilyEntry] }]) {
  useWebSearchProviderListsMock.mockReturnValue({
    defaultFetchUrlsProvider: undefined,
    defaultSearchKeywordsProvider: undefined,
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

describe('WebSearchSettings active provider state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockProviderLists()
  })

  it('resets to general settings when the active provider entry disappears', async () => {
    const { rerender } = render(<WebSearchSettings />)

    fireEvent.click(screen.getByRole('button', { name: 'Tavily' }))
    expect(screen.getByText('Tavily provider-settings')).toBeInTheDocument()

    mockProviderLists([])
    rerender(<WebSearchSettings />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'settings.tool.websearch.search_provider' })).toHaveAttribute(
        'data-active',
        'true'
      )
    })
    expect(screen.getByText('general-settings')).toBeInTheDocument()
  })
})
