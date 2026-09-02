import type * as ProviderUtils from '@shared/utils/provider'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ProviderApiOptionsDrawer from '../ProviderApiOptionsDrawer'

const updateProviderMock = vi.fn()
const useProviderMock = vi.fn()
const isAnthropicSupportedProviderMock = vi.fn()
const isAzureOpenAIProviderMock = vi.fn()
const isOpenAICompatibleProviderMock = vi.fn()
const isSystemProviderMock = vi.fn()

vi.mock('@renderer/hooks/useProvider', () => ({
  useProvider: (...args: unknown[]) => useProviderMock(...args)
}))

vi.mock('@renderer/utils/style', () => ({
  cn: (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' ')
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

vi.mock('../../primitives/ProviderSettingsDrawer', () => ({
  default: ({ open, title, footer, children }: any) =>
    open ? (
      <div>
        <h2>{title}</h2>
        {children}
        {footer}
      </div>
    ) : null
}))

vi.mock('@shared/utils/provider', async (importOriginal) => ({
  ...(await importOriginal<typeof ProviderUtils>()),
  isAnthropicSupportedProvider: (...args: unknown[]) => isAnthropicSupportedProviderMock(...args),
  isAzureOpenAIProvider: (...args: unknown[]) => isAzureOpenAIProviderMock(...args),
  isOpenAICompatibleProvider: (...args: unknown[]) => isOpenAICompatibleProviderMock(...args),
  isSystemProvider: (...args: unknown[]) => isSystemProviderMock(...args)
}))

vi.mock('@cherrystudio/ui', async (importOriginal) => {
  const actual = await importOriginal<object>()
  const React = await import('react')
  const SelectContext = React.createContext<{ onValueChange?: (value: string) => void }>({})

  return {
    ...actual,
    Button: ({ children, onClick, ...props }: any) => (
      <button type="button" onClick={onClick} {...props}>
        {children}
      </button>
    ),
    Input: (props: any) => <input {...props} />,
    PageSidePanelItem: ({ title, action }: any) => (
      <div>
        {title}
        {action}
      </div>
    ),
    Switch: ({ checked, onCheckedChange, ...props }: any) => (
      <input type="checkbox" checked={checked} onChange={(event) => onCheckedChange(event.target.checked)} {...props} />
    ),
    Tooltip: ({ children }: any) => <>{children}</>,
    Select: ({ children, onValueChange }: any) => <SelectContext value={{ onValueChange }}>{children}</SelectContext>,
    SelectTrigger: ({ children, ...props }: any) => <div {...props}>{children}</div>,
    SelectValue: () => null,
    SelectContent: ({ children }: any) => <div>{children}</div>,
    SelectItem: ({ children, value }: any) => {
      const { onValueChange } = React.use(SelectContext)
      return (
        <button type="button" aria-label={`cache-ttl-${value}`} onClick={() => onValueChange?.(value)}>
          {children}
        </button>
      )
    }
  }
})

const provider = {
  id: 'openai',
  name: 'OpenAI',
  presetProviderId: 'openai',
  isEnabled: true,
  defaultChatEndpoint: 'openai-chat-completions',
  authType: 'api-key',
  apiKeys: [],
  endpointConfigs: {
    'openai-chat-completions': { baseUrl: 'https://api.example.com/v1' },
    'anthropic-messages': { baseUrl: 'https://api.example.com/anthropic' }
  },
  reportsActualCost: false,
  settings: {
    streamOptions: {
      includeUsage: undefined
    },
    cacheControl: {
      enabled: true,
      tokenThreshold: 1024,
      cacheSystemMessage: true,
      cacheLastNMessages: 2
    }
  }
}

describe('ProviderApiOptionsDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    updateProviderMock.mockResolvedValue(undefined)
    useProviderMock.mockReturnValue({
      provider,
      updateProvider: updateProviderMock
    })
    isOpenAICompatibleProviderMock.mockReturnValue(true)
    isAzureOpenAIProviderMock.mockReturnValue(false)
    isAnthropicSupportedProviderMock.mockReturnValue(true)
    isSystemProviderMock.mockReturnValue(false)
  })

  it('preserves sibling endpoints when changing the selected endpoint dialect', () => {
    render(<ProviderApiOptionsDrawer providerId="openai" open onClose={vi.fn()} />)

    fireEvent.click(screen.getByLabelText('settings.provider.api.options.developer_role.label'))

    expect(updateProviderMock).toHaveBeenCalledWith({
      endpointConfigs: {
        'openai-chat-completions': {
          baseUrl: 'https://api.example.com/v1',
          dialect: { developerRole: true }
        },
        'anthropic-messages': { baseUrl: 'https://api.example.com/anthropic' }
      }
    })
  })

  it('offers the summary compatibility switch only on a Responses endpoint and persists it there', () => {
    useProviderMock.mockReturnValue({
      provider: {
        ...provider,
        defaultChatEndpoint: 'openai-responses',
        endpointConfigs: { 'openai-responses': { baseUrl: 'https://api.example.com/v1' } }
      },
      updateProvider: updateProviderMock
    })

    render(<ProviderApiOptionsDrawer providerId="openai" open onClose={vi.fn()} />)

    expect(screen.getByLabelText('settings.provider.api.options.developer_role.label')).toBeInTheDocument()
    expect(screen.queryByLabelText('settings.provider.api.options.stream_options.label')).not.toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('settings.provider.api.options.reasoning_summary.label'))

    expect(updateProviderMock).toHaveBeenCalledWith({
      endpointConfigs: {
        'openai-responses': {
          baseUrl: 'https://api.example.com/v1',
          dialect: { reasoningSummary: true }
        }
      }
    })
  })

  it('patches providerSettings.cacheControl when cache threshold changes', () => {
    render(<ProviderApiOptionsDrawer providerId="openai" open onClose={vi.fn()} />)

    const input = screen.getByLabelText('settings.provider.api.options.anthropic_cache.token_threshold')
    fireEvent.change(input, { target: { value: '2048' } })
    fireEvent.blur(input)

    expect(updateProviderMock).toHaveBeenCalledWith({
      providerSettings: {
        ...provider.settings,
        cacheControl: {
          enabled: true,
          tokenThreshold: 2048,
          cacheSystemMessage: true,
          cacheLastNMessages: 2
        }
      }
    })
  })

  it('shows default Anthropic cache values when cacheControl is unset', () => {
    useProviderMock.mockReturnValue({
      provider: { ...provider, settings: { ...provider.settings, cacheControl: undefined } },
      updateProvider: updateProviderMock
    })

    render(<ProviderApiOptionsDrawer providerId="openai" open onClose={vi.fn()} />)

    expect(screen.getByLabelText('settings.provider.api.options.anthropic_cache.token_threshold')).toHaveValue(1024)
    expect(screen.getByLabelText('settings.provider.api.options.anthropic_cache.cache_last_n')).toHaveValue(2)
  })

  it('persists a one-hour Anthropic cache lifetime without dropping sibling settings', () => {
    render(<ProviderApiOptionsDrawer providerId="openai" open onClose={vi.fn()} />)

    fireEvent.click(screen.getByLabelText('cache-ttl-1h'))

    expect(updateProviderMock).toHaveBeenCalledWith({
      providerSettings: {
        ...provider.settings,
        cacheControl: {
          enabled: true,
          tokenThreshold: 1024,
          cacheSystemMessage: true,
          cacheLastNMessages: 2,
          ttl: '1h'
        }
      }
    })
  })

  it('renders nothing for a non-OpenAI provider without anthropic cache support', () => {
    isOpenAICompatibleProviderMock.mockReturnValue(false)
    isAnthropicSupportedProviderMock.mockReturnValue(false)

    render(<ProviderApiOptionsDrawer providerId="openai" open onClose={vi.fn()} />)

    expect(screen.queryByLabelText('settings.provider.api.options.developer_role.label')).not.toBeInTheDocument()
    expect(screen.queryByText('settings.openai.title')).not.toBeInTheDocument()
    expect(
      screen.queryByLabelText('settings.provider.api.options.anthropic_cache.token_threshold')
    ).not.toBeInTheDocument()
  })
})
