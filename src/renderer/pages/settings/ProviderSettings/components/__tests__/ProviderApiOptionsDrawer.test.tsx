import { fireEvent, render, screen } from '@testing-library/react'
import type * as ReactModule from 'react'
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

vi.mock('@renderer/utils', () => ({
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

vi.mock('@shared/utils/provider', () => ({
  isAnthropicSupportedProvider: (...args: unknown[]) => isAnthropicSupportedProviderMock(...args),
  isAzureOpenAIProvider: (...args: unknown[]) => isAzureOpenAIProviderMock(...args),
  isOpenAICompatibleProvider: (...args: unknown[]) => isOpenAICompatibleProviderMock(...args),
  isSystemProvider: (...args: unknown[]) => isSystemProviderMock(...args)
}))

vi.mock('@cherrystudio/ui', async () => {
  const React = await vi.importActual<typeof ReactModule>('react')
  const SelectContext = React.createContext<((value: string) => void) | undefined>(undefined)

  return {
    Button: ({ children, onClick, ...props }: any) => (
      <button type="button" onClick={onClick} {...props}>
        {children}
      </button>
    ),
    Input: (props: any) => <input {...props} />,
    Select: ({ children, disabled, onValueChange }: any) => (
      <SelectContext value={disabled ? undefined : onValueChange}>{children}</SelectContext>
    ),
    SelectContent: ({ children }: any) => <div>{children}</div>,
    SelectItem: ({ children, value, ...props }: any) => {
      const onValueChange = React.use(SelectContext)
      return (
        <button type="button" onClick={() => onValueChange?.(value)} {...props}>
          {children}
        </button>
      )
    },
    SelectTrigger: ({ children, ...props }: any) => (
      <button type="button" {...props}>
        {children}
      </button>
    ),
    SelectValue: () => <span />,
    Switch: ({ checked, onCheckedChange, ...props }: any) => (
      <input type="checkbox" checked={checked} onChange={(event) => onCheckedChange(event.target.checked)} {...props} />
    ),
    Tooltip: ({ children }: any) => <>{children}</>
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
  endpointConfigs: {},
  apiFeatures: {
    arrayContent: true,
    streamOptions: true,
    developerRole: false,
    serviceTier: false,
    verbosity: false,
    enableThinking: true
  },
  settings: {
    serviceTier: undefined,
    summaryText: undefined,
    verbosity: undefined,
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

  it('patches apiFeatures when an option changes', () => {
    render(<ProviderApiOptionsDrawer providerId="openai" open onClose={vi.fn()} />)

    fireEvent.click(screen.getByLabelText('settings.provider.api.options.developer_role.label'))

    expect(updateProviderMock).toHaveBeenCalledWith({
      apiFeatures: {
        ...provider.apiFeatures,
        developerRole: true
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

  it('patches OpenAI provider settings from value options', () => {
    const openAIProvider = {
      ...provider,
      defaultChatEndpoint: 'openai-responses',
      apiFeatures: {
        ...provider.apiFeatures,
        serviceTier: true,
        verbosity: true
      }
    }
    useProviderMock.mockReturnValue({
      provider: openAIProvider,
      updateProvider: updateProviderMock
    })

    render(<ProviderApiOptionsDrawer providerId="openai" open onClose={vi.fn()} />)

    fireEvent.click(screen.getByText('settings.openai.service_tier.priority'))
    fireEvent.click(screen.getByText('settings.openai.summary_text_mode.detailed'))
    fireEvent.click(screen.getByText('settings.openai.verbosity.high'))

    expect(updateProviderMock).toHaveBeenCalledWith({
      providerSettings: {
        ...openAIProvider.settings,
        serviceTier: 'priority'
      }
    })
    expect(updateProviderMock).toHaveBeenCalledWith({
      providerSettings: {
        ...openAIProvider.settings,
        summaryText: 'detailed'
      }
    })
    expect(updateProviderMock).toHaveBeenCalledWith({
      providerSettings: {
        ...openAIProvider.settings,
        verbosity: 'high'
      }
    })
    expect(screen.queryByText('settings.openai.stream_options.include_usage.title')).not.toBeInTheDocument()
  })

  it('hides api feature toggles for system OpenAI-compatible providers', () => {
    const systemProvider = {
      ...provider,
      defaultChatEndpoint: 'openai-responses',
      apiFeatures: {
        ...provider.apiFeatures,
        serviceTier: true,
        verbosity: true
      }
    }
    useProviderMock.mockReturnValue({
      provider: systemProvider,
      updateProvider: updateProviderMock
    })
    isSystemProviderMock.mockReturnValue(true)

    render(<ProviderApiOptionsDrawer providerId="openai" open onClose={vi.fn()} />)

    expect(screen.queryByLabelText('settings.provider.api.options.array_content.label')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('settings.provider.api.options.developer_role.label')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('settings.provider.api.options.stream_options.label')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('settings.provider.api.options.service_tier.label')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('settings.provider.api.options.verbosity.label')).not.toBeInTheDocument()
    expect(screen.getByText('settings.openai.title')).toBeInTheDocument()
    expect(screen.getByText('settings.openai.summary_text_mode.title')).toBeInTheDocument()
  })

  it('patches Groq service tier from the provider api options drawer', () => {
    const groqProvider = {
      ...provider,
      id: 'groq',
      name: 'Groq',
      apiFeatures: {
        ...provider.apiFeatures,
        streamOptions: false,
        serviceTier: true
      },
      settings: {
        serviceTier: undefined
      }
    }
    useProviderMock.mockReturnValue({
      provider: groqProvider,
      updateProvider: updateProviderMock
    })
    isOpenAICompatibleProviderMock.mockReturnValue(false)

    render(<ProviderApiOptionsDrawer providerId="groq" open onClose={vi.fn()} />)

    fireEvent.click(screen.getByText('settings.openai.service_tier.on_demand'))

    expect(updateProviderMock).toHaveBeenCalledWith({
      providerSettings: {
        ...groqProvider.settings,
        serviceTier: 'on_demand'
      }
    })
  })

  it('only renders array content for non OpenAI providers without anthropic cache support', () => {
    isOpenAICompatibleProviderMock.mockReturnValue(false)
    isAnthropicSupportedProviderMock.mockReturnValue(false)

    render(<ProviderApiOptionsDrawer providerId="openai" open onClose={vi.fn()} />)

    expect(screen.getByLabelText('settings.provider.api.options.array_content.label')).toBeInTheDocument()
    expect(screen.queryByLabelText('settings.provider.api.options.developer_role.label')).not.toBeInTheDocument()
    expect(screen.queryByText('settings.openai.title')).not.toBeInTheDocument()
    expect(
      screen.queryByLabelText('settings.provider.api.options.anthropic_cache.token_threshold')
    ).not.toBeInTheDocument()
  })
})
