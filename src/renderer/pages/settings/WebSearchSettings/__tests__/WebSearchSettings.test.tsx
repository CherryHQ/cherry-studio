import '@testing-library/jest-dom/vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'
import { toast } from '@renderer/services/toast'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type * as ReactI18next from 'react-i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as WebSearchApiKeyListHook from '../hooks/useWebSearchApiKeyList'
import WebSearchSettings from '../WebSearchSettings'

const ipcRequestMock = vi.hoisted(() => vi.fn())
const mocks = vi.hoisted(() => ({
  useWebSearchApiKeyList: vi.fn()
}))

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactI18next>()

  return {
    ...actual,
    useTranslation: () => ({ t: (key: string) => key })
  }
})

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn()
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: {
    request: ipcRequestMock
  }
}))

vi.mock('@renderer/components/Scrollbar', () => ({
  default: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>
}))

vi.mock('@cherrystudio/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof CherryStudioUi>()
  const React = await import('react')
  const SelectContext = React.createContext<{ onValueChange?: (value: string) => void }>({})

  return {
    ...actual,
    Alert: ({ children, message, ...props }: React.HTMLAttributes<HTMLDivElement> & { message?: React.ReactNode }) => (
      <div role="alert" {...props}>
        {message}
        {children}
      </div>
    ),
    Badge: ({ children, ...props }: React.HTMLAttributes<HTMLSpanElement>) => <span {...props}>{children}</span>,
    ButtonGroup: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
      <div role="group" {...props}>
        {children}
      </div>
    ),
    Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
      <button type="button" {...props}>
        {children}
      </button>
    ),
    Flex: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
    InfoTooltip: ({ children }: React.HTMLAttributes<HTMLDivElement>) => <>{children}</>,
    Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
    Label: ({ children, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) => (
      <label {...props}>{children}</label>
    ),
    MenuDivider: (props: React.HTMLAttributes<HTMLDivElement>) => <div role="separator" {...props} />,
    MenuItem: ({
      label,
      icon,
      suffix,
      active,
      ...props
    }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
      label: string
      icon?: React.ReactNode
      suffix?: React.ReactNode
      active?: boolean
    }) => (
      <button type="button" data-active={active || undefined} {...props}>
        {icon}
        {label}
        {suffix}
      </button>
    ),
    MenuList: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
    RowFlex: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
    Select: ({
      children,
      onValueChange,
      value
    }: React.HTMLAttributes<HTMLDivElement> & { onValueChange?: (value: string) => void; value?: string }) => (
      <SelectContext value={{ onValueChange }}>
        <div data-testid="select" data-value={value}>
          {children}
        </div>
      </SelectContext>
    ),
    SelectContent: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
    SelectItem: ({ children, value, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { value: string }) => {
      const { onValueChange } = React.use(SelectContext)

      return (
        <button type="button" value={value} onClick={() => onValueChange?.(value)} {...props}>
          {children}
        </button>
      )
    },
    SelectTrigger: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { size?: string }) => (
      <button type="button" {...props}>
        {children}
      </button>
    ),
    SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span>,
    Textarea: {
      Input: (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...props} />
    },
    Tooltip: ({ children }: React.HTMLAttributes<HTMLDivElement>) => <>{children}</>
  }
})

vi.mock('../components/WebSearchProviderLogo', () => ({
  default: ({ providerName }: { providerName: string }) => <span aria-label={`${providerName} logo`} />
}))

vi.mock('../hooks/useWebSearchApiKeyList', async (importOriginal) => ({
  ...(await importOriginal<typeof WebSearchApiKeyListHook>()),
  useWebSearchApiKeyList: (...args: unknown[]) => mocks.useWebSearchApiKeyList(...args)
}))

describe('WebSearchSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MockUsePreferenceUtils.resetMocks()
    ipcRequestMock.mockResolvedValue({ results: [] })
    MockUsePreferenceUtils.setPreferenceValue('chat.web_search.provider_overrides', {})
    MockUsePreferenceUtils.setPreferenceValue('chat.web_search.default_search_keywords_provider', 'tavily')
    MockUsePreferenceUtils.setPreferenceValue('chat.web_search.default_fetch_urls_provider', 'fetch')
    MockUsePreferenceUtils.setPreferenceValue('chat.web_search.exclude_domains', [])
    MockUsePreferenceUtils.setPreferenceValue('chat.web_search.max_results', 5)
    MockUsePreferenceUtils.setPreferenceValue('chat.web_search.compression.method', 'none')
    MockUsePreferenceUtils.setPreferenceValue('chat.web_search.compression.cutoff_limit', 2000)
    mocks.useWebSearchApiKeyList.mockReturnValue({
      provider: undefined,
      keys: [],
      displayItems: [],
      hasPendingNewKey: false,
      addPendingKey: vi.fn(),
      updateListItem: vi.fn(),
      removeListItem: vi.fn()
    })
  })

  const getKeywordProviderSection = () =>
    screen.getByRole('region', { name: 'settings.tool.websearch.search_provider' })
  const getFetchProviderSection = () =>
    screen.getByRole('region', { name: 'settings.tool.websearch.fetch_urls_provider' })

  it('renders both provider sections before general settings', () => {
    render(<WebSearchSettings />)

    const generalSettings = screen.getByText('settings.general.label')
    const keywordProviderSection = getKeywordProviderSection()
    const fetchProviderSection = getFetchProviderSection()

    expect(generalSettings).toBeInTheDocument()
    expect(screen.getByText('settings.tool.websearch.search_max_result.label')).toBeInTheDocument()
    expect(keywordProviderSection).toBeInTheDocument()
    expect(fetchProviderSection).toBeInTheDocument()
    expect(
      fetchProviderSection.compareDocumentPosition(generalSettings) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(
      within(keywordProviderSection).getByRole('button', {
        name: 'settings.tool.websearch.search_provider'
      })
    ).toBeInTheDocument()
    expect(
      within(fetchProviderSection).getByRole('button', {
        name: 'settings.tool.websearch.fetch_urls_provider'
      })
    ).toBeInTheDocument()
  })

  it('syncs clean max-result drafts from external preference changes', () => {
    const { rerender } = render(<WebSearchSettings />)

    expect(screen.getByLabelText('settings.tool.websearch.search_max_result.label')).toHaveValue(5)

    MockUsePreferenceUtils.simulateExternalPreferenceChange('chat.web_search.max_results', 20)
    rerender(<WebSearchSettings />)

    expect(screen.getByLabelText('settings.tool.websearch.search_max_result.label')).toHaveValue(20)
  })

  it('keeps dirty max-result drafts when maxResults changes externally', () => {
    const { rerender } = render(<WebSearchSettings />)

    fireEvent.change(screen.getByLabelText('settings.tool.websearch.search_max_result.label'), {
      target: { value: '10' }
    })
    expect(screen.getByLabelText('settings.tool.websearch.search_max_result.label')).toHaveValue(10)

    MockUsePreferenceUtils.simulateExternalPreferenceChange('chat.web_search.max_results', 20)
    rerender(<WebSearchSettings />)

    expect(screen.getByLabelText('settings.tool.websearch.search_max_result.label')).toHaveValue(10)
  })

  it('marks max-result drafts clean after a successful commit', async () => {
    const { rerender } = render(<WebSearchSettings />)

    fireEvent.change(screen.getByLabelText('settings.tool.websearch.search_max_result.label'), {
      target: { value: '10' }
    })
    fireEvent.blur(screen.getByLabelText('settings.tool.websearch.search_max_result.label'))

    await waitFor(() => {
      expect(MockUsePreferenceUtils.getPreferenceValue('chat.web_search.max_results')).toBe(10)
    })

    MockUsePreferenceUtils.simulateExternalPreferenceChange('chat.web_search.max_results', 20)
    rerender(<WebSearchSettings />)

    await waitFor(() => {
      expect(screen.getByLabelText('settings.tool.websearch.search_max_result.label')).toHaveValue(20)
    })
  })

  it.each([
    ['1000', 100],
    ['-3', 1],
    ['abc', 1],
    ['3.9', 3]
  ])('clamps max-result draft %s to %s on commit', async (value, expected) => {
    render(<WebSearchSettings />)

    fireEvent.change(screen.getByLabelText('settings.tool.websearch.search_max_result.label'), {
      target: { value }
    })
    fireEvent.blur(screen.getByLabelText('settings.tool.websearch.search_max_result.label'))

    await waitFor(() => {
      expect(MockUsePreferenceUtils.getPreferenceValue('chat.web_search.max_results')).toBe(expected)
      expect(screen.getByLabelText('settings.tool.websearch.search_max_result.label')).toHaveValue(expected)
    })
  })

  it('resets max results to the default value when customized', async () => {
    render(<WebSearchSettings />)

    expect(screen.queryByRole('button', { name: 'common.reset' })).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('settings.tool.websearch.search_max_result.label'), {
      target: { value: '10' }
    })
    fireEvent.blur(screen.getByLabelText('settings.tool.websearch.search_max_result.label'))

    await waitFor(() => {
      expect(MockUsePreferenceUtils.getPreferenceValue('chat.web_search.max_results')).toBe(10)
    })

    fireEvent.click(screen.getByRole('button', { name: 'common.reset' }))

    await waitFor(() => {
      expect(MockUsePreferenceUtils.getPreferenceValue('chat.web_search.max_results')).toBe(5)
      expect(screen.getByLabelText('settings.tool.websearch.search_max_result.label')).toHaveValue(5)
    })
  })

  it('syncs clean blacklist drafts from external preference changes', () => {
    const { rerender } = render(<WebSearchSettings />)

    const textarea = screen.getByPlaceholderText('settings.tool.websearch.blacklist_tooltip')
    expect(textarea).toHaveValue('')

    MockUsePreferenceUtils.simulateExternalPreferenceChange('chat.web_search.exclude_domains', [
      'https://example.com/*'
    ])
    rerender(<WebSearchSettings />)

    expect(screen.getByPlaceholderText('settings.tool.websearch.blacklist_tooltip')).toHaveValue(
      'https://example.com/*'
    )
  })

  it('keeps dirty blacklist drafts when excludeDomains changes externally', () => {
    const { rerender } = render(<WebSearchSettings />)

    fireEvent.change(screen.getByPlaceholderText('settings.tool.websearch.blacklist_tooltip'), {
      target: { value: 'https://draft.example/*' }
    })

    MockUsePreferenceUtils.simulateExternalPreferenceChange('chat.web_search.exclude_domains', [
      'https://external.example/*'
    ])
    rerender(<WebSearchSettings />)

    expect(screen.getByPlaceholderText('settings.tool.websearch.blacklist_tooltip')).toHaveValue(
      'https://draft.example/*'
    )
  })

  it('marks blacklist drafts clean after a successful save', async () => {
    const { rerender } = render(<WebSearchSettings />)

    fireEvent.change(screen.getByPlaceholderText('settings.tool.websearch.blacklist_tooltip'), {
      target: { value: 'https://saved.example/*' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }))

    await waitFor(() => {
      expect(MockUsePreferenceUtils.getPreferenceValue('chat.web_search.exclude_domains')).toEqual([
        'https://saved.example/*'
      ])
    })

    MockUsePreferenceUtils.simulateExternalPreferenceChange('chat.web_search.exclude_domains', [
      'https://external.example/*'
    ])
    rerender(<WebSearchSettings />)

    expect(screen.getByPlaceholderText('settings.tool.websearch.blacklist_tooltip')).toHaveValue(
      'https://external.example/*'
    )
  })

  it('saves default cutoff limit when cutoff input is cleared', async () => {
    MockUsePreferenceUtils.setPreferenceValue('chat.web_search.compression.method', 'cutoff')
    MockUsePreferenceUtils.setPreferenceValue('chat.web_search.compression.cutoff_limit', 5000)
    render(<WebSearchSettings />)

    fireEvent.change(screen.getByPlaceholderText('settings.tool.websearch.compression.cutoff.limit.placeholder'), {
      target: { value: '' }
    })

    await waitFor(() => {
      expect(MockUsePreferenceUtils.getPreferenceValue('chat.web_search.compression.cutoff_limit')).toBe(2000)
    })
  })

  it('saves positive cutoff limit input values', async () => {
    MockUsePreferenceUtils.setPreferenceValue('chat.web_search.compression.method', 'cutoff')
    render(<WebSearchSettings />)

    fireEvent.change(screen.getByPlaceholderText('settings.tool.websearch.compression.cutoff.limit.placeholder'), {
      target: { value: '3500' }
    })

    await waitFor(() => {
      expect(MockUsePreferenceUtils.getPreferenceValue('chat.web_search.compression.cutoff_limit')).toBe(3500)
    })
  })

  it('ignores invalid cutoff limit input values', () => {
    MockUsePreferenceUtils.setPreferenceValue('chat.web_search.compression.method', 'cutoff')
    MockUsePreferenceUtils.setPreferenceValue('chat.web_search.compression.cutoff_limit', 5000)
    render(<WebSearchSettings />)

    const input = screen.getByPlaceholderText('settings.tool.websearch.compression.cutoff.limit.placeholder')
    fireEvent.change(input, { target: { value: 'abc' } })
    fireEvent.change(input, { target: { value: '0' } })
    fireEvent.change(input, { target: { value: '-1' } })

    expect(MockUsePreferenceUtils.getPreferenceValue('chat.web_search.compression.cutoff_limit')).toBe(5000)
  })

  it('uses the selected keyword provider as the default', async () => {
    const { rerender } = render(<WebSearchSettings />)

    const section = getKeywordProviderSection()
    fireEvent.click(within(section).getByRole('button', { name: /^Exa logo Exa$/ }))

    await waitFor(() => {
      expect(MockUsePreferenceUtils.getPreferenceValue('chat.web_search.default_search_keywords_provider')).toBe('exa')
    })
    rerender(<WebSearchSettings />)

    const updatedSection = getKeywordProviderSection()
    expect(within(updatedSection).getByText('settings.tool.websearch.provider_description.exa')).toBeInTheDocument()
    expect(within(updatedSection).getAllByText('Exa').length).toBeGreaterThan(0)
    expect(within(updatedSection).getByText('settings.provider.api_key.label')).toBeInTheDocument()
    expect(within(updatedSection).getByRole('button', { name: 'settings.tool.websearch.check' })).not.toBeDisabled()
    expect(within(updatedSection).queryByText('common.default')).not.toBeInTheDocument()
    expect(within(updatedSection).queryByText('settings.tool.websearch.set_as_default')).not.toBeInTheDocument()
  })

  it('does not show API host settings for the built-in URL fetch provider', () => {
    render(<WebSearchSettings />)

    const section = getFetchProviderSection()

    expect(within(section).getAllByText('fetch').length).toBeGreaterThan(0)
    expect(within(section).getByText('settings.tool.websearch.provider_description.fetch')).toBeInTheDocument()
    expect(within(section).queryByText('settings.provider.api_host')).not.toBeInTheDocument()
    expect(within(section).queryByRole('button', { name: 'settings.tool.websearch.check' })).not.toBeInTheDocument()
  })

  it('saves API key drafts before checking keyword providers', async () => {
    render(<WebSearchSettings />)

    const section = getKeywordProviderSection()
    fireEvent.change(within(section).getByPlaceholderText('settings.provider.api_key.label'), {
      target: { value: 'tavily-key' }
    })
    fireEvent.click(within(section).getByRole('button', { name: 'settings.tool.websearch.check' }))

    await waitFor(() => {
      expect(ipcRequestMock).toHaveBeenCalledWith('web_search.search_keywords', {
        providerId: 'tavily',
        keywords: ['Cherry Studio']
      })
    })
    expect(MockUsePreferenceUtils.getPreferenceValue('chat.web_search.provider_overrides')).toMatchObject({
      tavily: { apiKeys: ['tavily-key'] }
    })
    expect(toast.success).toHaveBeenCalledWith('settings.tool.websearch.check_success')
  })

  it('keeps local API key drafts when provider overrides change externally', () => {
    const { rerender } = render(<WebSearchSettings />)

    const section = getKeywordProviderSection()
    fireEvent.change(within(section).getByPlaceholderText('settings.provider.api_key.label'), {
      target: { value: 'draft-tavily-key' }
    })

    MockUsePreferenceUtils.simulateExternalPreferenceChange('chat.web_search.provider_overrides', {
      zhipu: { apiKeys: ['zhipu-key'] }
    })
    rerender(<WebSearchSettings />)

    expect(within(getKeywordProviderSection()).getByPlaceholderText('settings.provider.api_key.label')).toHaveValue(
      'draft-tavily-key'
    )
  })

  it('checks the active fetchUrls capability with the fixed URL probe', async () => {
    const { rerender } = render(<WebSearchSettings />)

    const section = getFetchProviderSection()
    fireEvent.click(within(section).getByRole('button', { name: /Jina/ }))

    await waitFor(() => {
      expect(MockUsePreferenceUtils.getPreferenceValue('chat.web_search.default_fetch_urls_provider')).toBe('jina')
    })
    rerender(<WebSearchSettings />)
    fireEvent.click(within(getFetchProviderSection()).getByRole('button', { name: 'settings.tool.websearch.check' }))

    await waitFor(() => {
      expect(ipcRequestMock).toHaveBeenCalledWith('web_search.fetch_urls', {
        providerId: 'jina',
        urls: ['https://example.com']
      })
    })
    expect(ipcRequestMock).not.toHaveBeenCalledWith('web_search.search_keywords', expect.anything())
  })

  it('shows a failed check toast when the IPC request rejects', async () => {
    ipcRequestMock.mockRejectedValue(new Error('check failed'))

    render(<WebSearchSettings />)

    fireEvent.click(within(getKeywordProviderSection()).getByRole('button', { name: 'settings.tool.websearch.check' }))

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('settings.tool.websearch.check_failed: check failed')
    })
  })

  it('does not check the provider when saving drafts before the check fails', async () => {
    MockUsePreferenceUtils.mockPreferenceError('chat.web_search.provider_overrides', new Error('persist failed'))

    render(<WebSearchSettings />)

    const section = getKeywordProviderSection()
    fireEvent.change(within(section).getByPlaceholderText('settings.provider.api_key.label'), {
      target: { value: 'tavily-key' }
    })
    fireEvent.click(within(section).getByRole('button', { name: 'settings.tool.websearch.check' }))

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('settings.tool.websearch.errors.save_failed')
    })
    expect(ipcRequestMock).not.toHaveBeenCalled()
  })

  it('shows a fallback instead of throwing when the API key list provider is missing', async () => {
    const { WebSearchApiKeyList } = await import('../components/WebSearchApiKeyList')

    expect(() => render(<WebSearchApiKeyList providerId={'missing-provider' as any} />)).not.toThrow()
    expect(screen.getByText('error.no_api_key')).toBeInTheDocument()
  })
})
