import '@testing-library/jest-dom/vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'
import type { WebSearchProvider } from '@shared/data/preference/preferenceTypes'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type * as ReactI18next from 'react-i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { WebSearchProviderSetting } from '../components/WebSearchProviderSetting'
import type { WebSearchProviderMenuEntry } from '../utils/webSearchProviderMeta'

const navigateMock = vi.fn()
const searchKeywordsMock = vi.fn()
const fetchUrlsMock = vi.fn()
const toastErrorMock = vi.fn()
const toastSuccessMock = vi.fn()
const showApiKeyListMock = vi.fn()

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactI18next>()

  return {
    ...actual,
    useTranslation: () => ({ t: (key: string) => key })
  }
})

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock
}))

vi.mock('@cherrystudio/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof CherryStudioUi>()),
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  ButtonGroup: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
    <div role="group" {...props}>
      {children}
    </div>
  ),
  Flex: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
  InfoTooltip: ({ children }: React.HTMLAttributes<HTMLDivElement>) => <>{children}</>,
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
  Label: ({ children, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) => <label {...props}>{children}</label>,
  RowFlex: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
  Tooltip: ({ children }: React.HTMLAttributes<HTMLDivElement>) => <>{children}</>
}))

vi.mock('../components/WebSearchProviderLogo', () => ({
  default: ({ providerName }: { providerName: string }) => <span aria-label={`${providerName} logo`} />
}))

vi.mock('../components/WebSearchApiKeyList', () => ({
  WebSearchApiKeyListPopup: {
    show: (...args: unknown[]) => showApiKeyListMock(...args)
  }
}))

function createEntry(overrides: Partial<WebSearchProviderMenuEntry> = {}): WebSearchProviderMenuEntry {
  const provider: WebSearchProvider = overrides.provider ?? {
    id: 'tavily',
    name: 'Tavily',
    type: 'api',
    apiKeys: ['key-a'],
    capabilities: [{ feature: 'searchKeywords' as const, apiHost: 'https://api.tavily.com' }],
    engines: [],
    basicAuthUsername: '',
    basicAuthPassword: ''
  }
  const capability = overrides.capability ?? 'searchKeywords'
  const providerCapability =
    overrides.providerCapability ?? provider.capabilities.find((item) => item.feature === capability)!

  return {
    key: `${capability}:${provider.id}`,
    capability,
    provider,
    providerCapability
  }
}

function createProps(entry = createEntry()) {
  return {
    entry,
    defaultProvider: undefined,
    providerOverrides: {},
    onSetApiKeys: vi.fn().mockResolvedValue(undefined),
    onSetBasicAuth: vi.fn().mockResolvedValue(undefined),
    onSetCapabilityApiHost: vi.fn().mockResolvedValue(undefined),
    onSetDefaultProvider: vi.fn().mockResolvedValue(undefined),
    onUpdateProvider: vi.fn().mockResolvedValue(undefined)
  }
}

describe('WebSearchProviderSetting', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.assign(window, {
      api: {
        ...window.api,
        webSearch: {
          searchKeywords: searchKeywordsMock,
          fetchUrls: fetchUrlsMock
        }
      },
      toast: {
        ...window.toast,
        error: toastErrorMock,
        success: toastSuccessMock
      }
    })
    searchKeywordsMock.mockResolvedValue({ results: [] })
    fetchUrlsMock.mockResolvedValue({ results: [] })
    showApiKeyListMock.mockResolvedValue(undefined)
  })

  it('renders API key controls and opens the key list after saving the current draft', async () => {
    const props = createProps()
    render(<WebSearchProviderSetting {...props} />)

    fireEvent.change(screen.getByPlaceholderText('settings.provider.api_key.label'), {
      target: { value: 'key-a,key-b' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'settings.provider.api.key.list.open' }))

    await waitFor(() => {
      expect(props.onSetApiKeys).toHaveBeenCalledWith('tavily', ['key-a', 'key-b'])
    })
    expect(showApiKeyListMock).toHaveBeenCalledWith({
      providerId: 'tavily',
      title: 'Tavily settings.provider.api.key.list.title'
    })
  })

  it('shows LLM provider settings for Zhipu instead of inline API key controls', () => {
    const zhipuProvider: WebSearchProvider = {
      id: 'zhipu',
      name: 'Zhipu',
      type: 'api',
      apiKeys: [],
      capabilities: [{ feature: 'searchKeywords' as const, apiHost: 'https://open.bigmodel.cn' }],
      engines: [],
      basicAuthUsername: '',
      basicAuthPassword: ''
    }
    render(<WebSearchProviderSetting {...createProps(createEntry({ provider: zhipuProvider }))} />)

    expect(screen.queryByPlaceholderText('settings.provider.api_key.label')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /navigate.provider_settings/ }))
    expect(navigateMock).toHaveBeenCalledWith({ to: '/settings/provider', search: { id: 'zhipu' } })
  })

  it('renders basic auth password only after username is present and persists credentials', async () => {
    const searxngProvider: WebSearchProvider = {
      id: 'searxng',
      name: 'SearXNG',
      type: 'api',
      apiKeys: [],
      capabilities: [{ feature: 'searchKeywords' as const, apiHost: 'https://search.example.com' }],
      engines: [],
      basicAuthUsername: '',
      basicAuthPassword: ''
    }
    const props = createProps(createEntry({ provider: searxngProvider }))
    render(<WebSearchProviderSetting {...props} />)

    expect(screen.queryByLabelText('settings.provider.basic_auth.password.label')).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('settings.provider.basic_auth.user_name.label'), {
      target: { value: ' user ' }
    })
    fireEvent.change(screen.getByLabelText('settings.provider.basic_auth.password.label'), {
      target: { value: ' pass ' }
    })
    fireEvent.blur(screen.getByLabelText('settings.provider.basic_auth.password.label'))

    await waitFor(() => {
      expect(props.onSetBasicAuth).toHaveBeenCalledWith('searxng', { username: 'user', password: 'pass' })
    })
  })

  it('does not render check controls for the zero-config fetch provider', () => {
    const fetchProvider: WebSearchProvider = {
      id: 'fetch',
      name: 'fetch',
      type: 'api',
      apiKeys: [],
      capabilities: [{ feature: 'fetchUrls' as const }],
      engines: [],
      basicAuthUsername: '',
      basicAuthPassword: ''
    }
    render(
      <WebSearchProviderSetting
        {...createProps(createEntry({ provider: fetchProvider, capability: 'fetchUrls' }))}
        defaultProvider={fetchProvider}
      />
    )

    expect(screen.queryByPlaceholderText('settings.provider.api_key.label')).not.toBeInTheDocument()
    expect(screen.queryByText('settings.provider.api_host')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'settings.tool.websearch.check' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'settings.tool.websearch.is_default' })).toBeDisabled()
  })

  it('persists API host changes for the active capability and checks fetchUrls providers', async () => {
    const jinaProvider: WebSearchProvider = {
      id: 'jina',
      name: 'Jina',
      type: 'api',
      apiKeys: ['key-a'],
      capabilities: [
        { feature: 'searchKeywords' as const, apiHost: 'https://s.jina.ai' },
        { feature: 'fetchUrls' as const, apiHost: 'https://r.jina.ai' }
      ],
      engines: [],
      basicAuthUsername: '',
      basicAuthPassword: ''
    }
    const props = createProps(
      createEntry({
        provider: jinaProvider,
        capability: 'fetchUrls',
        providerCapability: jinaProvider.capabilities[1]
      })
    )
    render(<WebSearchProviderSetting {...props} />)

    fireEvent.change(screen.getByPlaceholderText('settings.provider.api_host'), {
      target: { value: 'https://reader.example.com/' }
    })
    fireEvent.blur(screen.getByPlaceholderText('settings.provider.api_host'))

    await waitFor(() => {
      expect(props.onSetCapabilityApiHost).toHaveBeenCalledWith('jina', 'fetchUrls', 'https://reader.example.com')
    })

    fireEvent.click(screen.getByRole('button', { name: 'settings.tool.websearch.check' }))

    await waitFor(() => {
      expect(fetchUrlsMock).toHaveBeenCalledWith({ providerId: 'jina', urls: ['https://example.com'] })
    })
  })

  it('does not overwrite externally added API keys when unchanged inline input blurs', async () => {
    const props = createProps()
    const { rerender } = render(<WebSearchProviderSetting {...props} />)

    const updatedEntry = createEntry({
      provider: {
        ...props.entry.provider,
        apiKeys: ['key-a', 'key-b']
      }
    })
    rerender(<WebSearchProviderSetting {...props} entry={updatedEntry} />)
    fireEvent.blur(screen.getByPlaceholderText('settings.provider.api_key.label'))

    expect(props.onSetApiKeys).not.toHaveBeenCalled()
    expect(screen.getByPlaceholderText('settings.provider.api_key.label')).toHaveValue('key-a, key-b')
  })

  it('keeps dirty inline API key drafts when provider updates externally', () => {
    const props = createProps()
    const { rerender } = render(<WebSearchProviderSetting {...props} />)

    fireEvent.change(screen.getByPlaceholderText('settings.provider.api_key.label'), {
      target: { value: 'draft-key' }
    })

    const updatedEntry = createEntry({
      provider: {
        ...props.entry.provider,
        apiKeys: ['external-key']
      }
    })
    rerender(<WebSearchProviderSetting {...props} entry={updatedEntry} />)

    expect(screen.getByPlaceholderText('settings.provider.api_key.label')).toHaveValue('draft-key')
  })

  it('saves dirty drafts before checking and stops the check when persistence fails', async () => {
    const props = createProps()
    props.onUpdateProvider.mockRejectedValueOnce(new Error('persist failed'))
    render(<WebSearchProviderSetting {...props} />)

    fireEvent.change(screen.getByPlaceholderText('settings.provider.api_key.label'), {
      target: { value: 'key-b' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'settings.tool.websearch.check' }))

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith('settings.tool.websearch.errors.save_failed')
    })
    expect(searchKeywordsMock).not.toHaveBeenCalled()
  })
})
