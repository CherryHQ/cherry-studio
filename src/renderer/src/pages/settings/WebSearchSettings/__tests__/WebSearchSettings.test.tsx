import '@testing-library/jest-dom/vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type * as ReactI18next from 'react-i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import WebSearchSettings from '..'
import type * as WebSearchApiKeyListHook from '../hooks/useWebSearchApiKeyList'

const searchKeywordsMock = vi.fn()
const fetchUrlsMock = vi.fn()
const toastSuccessMock = vi.fn()
const toastErrorMock = vi.fn()
const toastInfoMock = vi.fn()
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

vi.mock('@renderer/components/Scrollbar', () => ({
  default: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>
}))

vi.mock('@cherrystudio/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof CherryStudioUi>()),
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
  Label: ({ children, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) => <label {...props}>{children}</label>,
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
    onValueChange
  }: React.HTMLAttributes<HTMLDivElement> & { onValueChange?: (value: string) => void; value?: string }) => (
    <div data-testid="select" data-on-value-change={Boolean(onValueChange)}>
      {children}
    </div>
  ),
  SelectContent: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
  SelectItem: ({ children, value, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { value: string }) => (
    <button type="button" value={value} {...props}>
      {children}
    </button>
  ),
  SelectTrigger: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { size?: string }) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span>,
  Slider: ({
    value,
    onValueChange,
    onValueCommit
  }: {
    value?: number[]
    onValueChange?: (value: number[]) => void
    onValueCommit?: (value: number[]) => void
  }) => (
    <div>
      <div data-testid="slider">{value?.[0]}</div>
      <button type="button" aria-label="slider-change-10" onClick={() => onValueChange?.([10])} />
      <button type="button" aria-label="slider-change-20" onClick={() => onValueChange?.([20])} />
      <button type="button" aria-label="slider-commit-10" onClick={() => onValueCommit?.([10])} />
    </div>
  ),
  Textarea: {
    Input: (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...props} />
  },
  Tooltip: ({ children }: React.HTMLAttributes<HTMLDivElement>) => <>{children}</>
}))

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
        success: toastSuccessMock,
        error: toastErrorMock,
        info: toastInfoMock
      }
    })
    searchKeywordsMock.mockResolvedValue({ results: [] })
    fetchUrlsMock.mockResolvedValue({ results: [] })
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

  it('renders general settings by default', () => {
    render(<WebSearchSettings />)

    expect(screen.getByRole('button', { name: 'settings.tool.websearch.search_provider' })).toHaveAttribute(
      'data-active',
      'true'
    )
    expect(screen.getAllByText('settings.tool.websearch.default_provider').length).toBeGreaterThan(0)
    expect(screen.getAllByText('settings.tool.websearch.fetch_urls_provider').length).toBeGreaterThan(0)
    expect(screen.getByText('settings.tool.websearch.search_max_result.label')).toBeInTheDocument()
  })

  it('syncs clean max-result drafts from external preference changes', () => {
    const { rerender } = render(<WebSearchSettings />)

    expect(screen.getByTestId('slider')).toHaveTextContent('5')

    MockUsePreferenceUtils.simulateExternalPreferenceChange('chat.web_search.max_results', 20)
    rerender(<WebSearchSettings />)

    expect(screen.getByTestId('slider')).toHaveTextContent('20')
  })

  it('keeps dirty max-result drafts when maxResults changes externally', () => {
    const { rerender } = render(<WebSearchSettings />)

    fireEvent.click(screen.getByRole('button', { name: 'slider-change-10' }))
    expect(screen.getByTestId('slider')).toHaveTextContent('10')

    MockUsePreferenceUtils.simulateExternalPreferenceChange('chat.web_search.max_results', 20)
    rerender(<WebSearchSettings />)

    expect(screen.getByTestId('slider')).toHaveTextContent('10')
  })

  it('marks max-result drafts clean after a successful commit', async () => {
    const { rerender } = render(<WebSearchSettings />)

    fireEvent.click(screen.getByRole('button', { name: 'slider-change-10' }))
    fireEvent.click(screen.getByRole('button', { name: 'slider-commit-10' }))

    await waitFor(() => {
      expect(MockUsePreferenceUtils.getPreferenceValue('chat.web_search.max_results')).toBe(10)
    })

    MockUsePreferenceUtils.simulateExternalPreferenceChange('chat.web_search.max_results', 20)
    rerender(<WebSearchSettings />)

    await waitFor(() => {
      expect(screen.getByTestId('slider')).toHaveTextContent('20')
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

  it('switches provider panels using local page state', () => {
    render(<WebSearchSettings />)

    fireEvent.click(screen.getAllByRole('button', { name: /Tavily/ })[0])

    expect(screen.getByText('settings.tool.websearch.provider_description.tavily')).toBeInTheDocument()
    expect(screen.getAllByText('Tavily').length).toBeGreaterThan(0)
    expect(screen.getAllByText('settings.provider.api_key.label').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'settings.tool.websearch.check' })).not.toBeDisabled()
  })

  it('does not show API host settings for the built-in URL fetch provider', () => {
    render(<WebSearchSettings />)

    fireEvent.click(screen.getAllByRole('button', { name: /fetch/ })[0])

    expect(screen.getAllByText('fetch').length).toBeGreaterThan(0)
    expect(screen.getByText('settings.tool.websearch.provider_description.fetch')).toBeInTheDocument()
    expect(screen.queryByText('settings.provider.api_host')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'settings.tool.websearch.check' })).not.toBeInTheDocument()
  })

  it('saves API key drafts before checking keyword providers', async () => {
    render(<WebSearchSettings />)

    fireEvent.click(screen.getAllByRole('button', { name: /Tavily/ })[0])
    fireEvent.change(screen.getByPlaceholderText('settings.provider.api_key.label'), {
      target: { value: 'tavily-key' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'settings.tool.websearch.check' }))

    await waitFor(() => {
      expect(searchKeywordsMock).toHaveBeenCalledWith({ providerId: 'tavily', keywords: ['Cherry Studio'] })
    })
    expect(MockUsePreferenceUtils.getPreferenceValue('chat.web_search.provider_overrides')).toMatchObject({
      tavily: { apiKeys: ['tavily-key'] }
    })
    expect(toastSuccessMock).toHaveBeenCalledWith('settings.tool.websearch.check_success')
  })

  it('keeps local API key drafts when provider overrides change externally', () => {
    const { rerender } = render(<WebSearchSettings />)

    fireEvent.click(screen.getAllByRole('button', { name: /Tavily/ })[0])
    fireEvent.change(screen.getByPlaceholderText('settings.provider.api_key.label'), {
      target: { value: 'draft-tavily-key' }
    })

    MockUsePreferenceUtils.simulateExternalPreferenceChange('chat.web_search.provider_overrides', {
      zhipu: { apiKeys: ['zhipu-key'] }
    })
    rerender(<WebSearchSettings />)

    expect(screen.getByPlaceholderText('settings.provider.api_key.label')).toHaveValue('draft-tavily-key')
  })

  it('checks the active fetchUrls capability with the fixed URL probe', async () => {
    render(<WebSearchSettings />)

    fireEvent.click(screen.getAllByRole('button', { name: /Jina/ })[1])
    fireEvent.click(screen.getByRole('button', { name: 'settings.tool.websearch.check' }))

    await waitFor(() => {
      expect(fetchUrlsMock).toHaveBeenCalledWith({ providerId: 'jina', urls: ['https://example.com'] })
    })
    expect(searchKeywordsMock).not.toHaveBeenCalled()
  })

  it('shows a failed check toast when the IPC request rejects', async () => {
    searchKeywordsMock.mockRejectedValue(new Error('check failed'))

    render(<WebSearchSettings />)

    fireEvent.click(screen.getAllByRole('button', { name: /Tavily/ })[0])
    fireEvent.click(screen.getByRole('button', { name: 'settings.tool.websearch.check' }))

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith('settings.tool.websearch.check_failed: check failed')
    })
  })

  it('does not check the provider when saving drafts before the check fails', async () => {
    MockUsePreferenceUtils.mockPreferenceError('chat.web_search.provider_overrides', new Error('persist failed'))

    render(<WebSearchSettings />)

    fireEvent.click(screen.getAllByRole('button', { name: /Tavily/ })[0])
    fireEvent.change(screen.getByPlaceholderText('settings.provider.api_key.label'), {
      target: { value: 'tavily-key' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'settings.tool.websearch.check' }))

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith('settings.tool.websearch.errors.save_failed')
    })
    expect(searchKeywordsMock).not.toHaveBeenCalled()
  })

  it('shows a fallback instead of throwing when the API key list provider is missing', async () => {
    const { WebSearchApiKeyList } = await import('../components/WebSearchApiKeyList')

    expect(() => render(<WebSearchApiKeyList providerId={'missing-provider' as any} />)).not.toThrow()
    expect(screen.getByText('error.no_api_key')).toBeInTheDocument()
  })
})
