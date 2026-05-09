import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ProviderApiOptionsDrawer from '../ProviderApiOptionsDrawer'

const updateProviderMock = vi.fn()
const useProviderMock = vi.fn()
const isAnthropicSupportedProviderMock = vi.fn()
const isAzureOpenAIProviderMock = vi.fn()
const isOpenAICompatibleProviderMock = vi.fn()

vi.mock('@renderer/hooks/useProviders', () => ({
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

vi.mock('../../shared/primitives/ProviderSettingsDrawer', () => ({
  default: ({ open, title, footer, children }: any) =>
    open ? (
      <div>
        <h2>{title}</h2>
        {children}
        {footer}
      </div>
    ) : null
}))

vi.mock('../../utils/provider', () => ({
  isAnthropicSupportedProvider: (...args: unknown[]) => isAnthropicSupportedProviderMock(...args),
  isAzureOpenAIProvider: (...args: unknown[]) => isAzureOpenAIProviderMock(...args),
  isOpenAICompatibleProvider: (...args: unknown[]) => isOpenAICompatibleProviderMock(...args)
}))

vi.mock('@cherrystudio/ui', () => {
  return {
    Button: ({ children, onClick, ...props }: any) => (
      <button type="button" onClick={onClick} {...props}>
        {children}
      </button>
    ),
    Input: (props: any) => <input {...props} />,
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

  it('only renders array content for non OpenAI providers without anthropic cache support', () => {
    isOpenAICompatibleProviderMock.mockReturnValue(false)
    isAnthropicSupportedProviderMock.mockReturnValue(false)

    render(<ProviderApiOptionsDrawer providerId="openai" open onClose={vi.fn()} />)

    expect(screen.getByLabelText('settings.provider.api.options.array_content.label')).toBeInTheDocument()
    expect(screen.queryByLabelText('settings.provider.api.options.developer_role.label')).not.toBeInTheDocument()
    expect(
      screen.queryByLabelText('settings.provider.api.options.anthropic_cache.token_threshold')
    ).not.toBeInTheDocument()
  })
})
