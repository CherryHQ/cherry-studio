import '@testing-library/jest-dom/vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { fireEvent, render, screen } from '@testing-library/react'
import type * as ReactI18next from 'react-i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import WebSearchSettings from '..'

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
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  InfoTooltip: ({ children }: React.HTMLAttributes<HTMLDivElement>) => <>{children}</>,
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
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
  Slider: ({ value }: { value?: number[] }) => <div data-testid="slider">{value?.[0]}</div>,
  Textarea: {
    Input: (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...props} />
  },
  Tooltip: ({ children }: React.HTMLAttributes<HTMLDivElement>) => <>{children}</>
}))

vi.mock('../components/WebSearchProviderLogo', () => ({
  default: ({ providerName }: { providerName: string }) => <span aria-label={`${providerName} logo`} />
}))

describe('WebSearchSettings', () => {
  beforeEach(() => {
    MockUsePreferenceUtils.resetMocks()
    MockUsePreferenceUtils.setPreferenceValue('chat.web_search.provider_overrides', {})
    MockUsePreferenceUtils.setPreferenceValue('chat.web_search.default_search_keywords_provider', 'tavily')
    MockUsePreferenceUtils.setPreferenceValue('chat.web_search.default_fetch_urls_provider', 'fetch')
    MockUsePreferenceUtils.setPreferenceValue('chat.web_search.exclude_domains', [])
    MockUsePreferenceUtils.setPreferenceValue('chat.web_search.max_results', 5)
    MockUsePreferenceUtils.setPreferenceValue('chat.web_search.compression.method', 'none')
    MockUsePreferenceUtils.setPreferenceValue('chat.web_search.compression.cutoff_limit', 2000)
  })

  it('renders general settings by default', () => {
    render(<WebSearchSettings />)

    expect(screen.getByRole('button', { name: 'settings.tool.websearch.search_provider' })).toHaveClass(
      'border-primary/15'
    )
  })

  it('switches provider panels using local page state', () => {
    render(<WebSearchSettings />)

    fireEvent.click(screen.getAllByRole('button', { name: /Tavily/ })[0])

    expect(screen.getByText('settings.tool.websearch.provider_description.tavily')).toBeInTheDocument()
    expect(screen.getAllByText('settings.provider.api_key.label').length).toBeGreaterThan(0)
  })
})
