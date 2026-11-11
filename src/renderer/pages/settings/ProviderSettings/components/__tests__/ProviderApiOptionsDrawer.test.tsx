import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'
import type * as ProviderUtils from '@shared/utils/provider'

import ProviderApiOptionsDrawer from '../ProviderApiOptionsDrawer'

const toastErrorMock = vi.fn()
vi.mock('@renderer/services/toast', () => ({ toast: { error: (...args: unknown[]) => toastErrorMock(...args) } }))

const updateProviderMock = vi.fn()
const useProviderMock = vi.fn()
const isAnthropicSupportedProviderMock = vi.fn()
const isAzureOpenAIProviderMock = vi.fn()
const isOpenAICompatibleProviderMock = vi.fn()
const isSystemProviderMock = vi.fn()

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  HTMLElement.prototype.hasPointerCapture ??= () => false
  HTMLElement.prototype.releasePointerCapture ??= () => {}
  HTMLElement.prototype.setPointerCapture ??= () => {}
  HTMLElement.prototype.scrollIntoView = () => {}
})

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
  const actual = await importOriginal<typeof CherryStudioUi>()

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

  it('saves the supported provider timeout as a single settings patch', () => {
    useProviderMock.mockReturnValue({
      provider: { ...provider, id: 'ppio', presetProviderId: 'ppio' },
      updateProvider: updateProviderMock
    })
    render(<ProviderApiOptionsDrawer providerId="ppio" open onClose={vi.fn()} />)
    const input = screen.getByLabelText('settings.provider.api.options.image_request_timeout.label')
    fireEvent.change(input, { target: { value: '900' } })
    fireEvent.blur(input)
    expect(updateProviderMock).toHaveBeenCalledWith({ providerSettings: { imageRequestTimeoutMs: 900_000 } })
  })

  it('shows the saved timeout and clears it with a null patch', () => {
    useProviderMock.mockReturnValue({
      provider: {
        ...provider,
        id: 'ppio',
        presetProviderId: 'ppio',
        settings: { ...provider.settings, imageRequestTimeoutMs: 900_000 }
      },
      updateProvider: updateProviderMock
    })
    render(<ProviderApiOptionsDrawer providerId="ppio" open onClose={vi.fn()} />)
    const input = screen.getByLabelText('settings.provider.api.options.image_request_timeout.label')
    expect(input).toHaveValue('900')
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.blur(input)
    expect(updateProviderMock).toHaveBeenCalledWith({ providerSettings: { imageRequestTimeoutMs: null } })
  })

  it('reports a failed save and restores the saved value', async () => {
    updateProviderMock.mockRejectedValueOnce(new Error('failed'))
    useProviderMock.mockReturnValue({
      provider: {
        ...provider,
        id: 'ppio',
        presetProviderId: 'ppio',
        settings: { ...provider.settings, imageRequestTimeoutMs: 600_000 }
      },
      updateProvider: updateProviderMock
    })
    render(<ProviderApiOptionsDrawer providerId="ppio" open onClose={vi.fn()} />)
    const input = screen.getByLabelText('settings.provider.api.options.image_request_timeout.label')
    fireEvent.change(input, { target: { value: '900' } })
    fireEvent.blur(input)
    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith('settings.provider.save_failed'))
    expect(input).toHaveValue('600')
  })

  it('does not show the timeout for unsupported providers', () => {
    useProviderMock.mockReturnValue({ provider: { ...provider, id: 'dmxapi' }, updateProvider: updateProviderMock })
    render(<ProviderApiOptionsDrawer providerId="dmxapi" open onClose={vi.fn()} />)
    expect(screen.queryByLabelText('settings.provider.api.options.image_request_timeout.label')).not.toBeInTheDocument()
  })

  it('shows the timeout for a duplicated dashscope provider', () => {
    const id = '00000000-0000-4000-8000-000000000002'
    useProviderMock.mockReturnValue({
      provider: { ...provider, id, presetProviderId: 'dashscope' },
      updateProvider: updateProviderMock
    })
    render(<ProviderApiOptionsDrawer providerId={id} open onClose={vi.fn()} />)
    expect(screen.getByLabelText('settings.provider.api.options.image_request_timeout.label')).toBeInTheDocument()
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

  // The provider query lands a round trip after the write, so the sibling field
  // commits against a snapshot that predates it. Tabbing from one field to the
  // next must not write the pre-edit threshold back.
  it('keeps a just-saved threshold when the sibling field commits before the query catches up', () => {
    render(<ProviderApiOptionsDrawer providerId="openai" open onClose={vi.fn()} />)

    const threshold = screen.getByLabelText('settings.provider.api.options.anthropic_cache.token_threshold')
    fireEvent.change(threshold, { target: { value: '2048' } })
    fireEvent.blur(threshold)

    const lastN = screen.getByLabelText('settings.provider.api.options.anthropic_cache.cache_last_n')
    fireEvent.change(lastN, { target: { value: '5' } })
    fireEvent.blur(lastN)

    expect(updateProviderMock).toHaveBeenLastCalledWith({
      providerSettings: {
        ...provider.settings,
        cacheControl: {
          enabled: true,
          tokenThreshold: 2048,
          cacheSystemMessage: true,
          cacheLastNMessages: 5
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

    expect(screen.getByLabelText('settings.provider.api.options.anthropic_cache.token_threshold')).toHaveValue('1024')
    expect(screen.getByLabelText('settings.provider.api.options.anthropic_cache.cache_last_n')).toHaveValue('2')
  })

  it('persists a one-hour Anthropic cache lifetime without dropping sibling settings', async () => {
    const user = userEvent.setup()
    render(<ProviderApiOptionsDrawer providerId="openai" open onClose={vi.fn()} />)

    await user.click(screen.getByRole('combobox', { name: 'settings.provider.api.options.anthropic_cache.cache_ttl' }))
    await user.click(screen.getByRole('option', { name: 'settings.provider.api.options.anthropic_cache.cache_ttl_1h' }))

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

  it('shows only the enable toggle and lifetime controls for gateway providers', () => {
    isAnthropicSupportedProviderMock.mockReturnValue(false)
    useProviderMock.mockReturnValue({
      provider: { ...provider, id: 'gateway', presetProviderId: 'gateway' },
      updateProvider: updateProviderMock
    })

    render(<ProviderApiOptionsDrawer providerId="gateway" open onClose={vi.fn()} />)

    expect(screen.getByLabelText('settings.provider.api.options.anthropic_cache.enable')).toBeChecked()
    expect(
      screen.getByRole('combobox', { name: 'settings.provider.api.options.anthropic_cache.cache_ttl' })
    ).toBeInTheDocument()
    expect(
      screen.queryByLabelText('settings.provider.api.options.anthropic_cache.token_threshold')
    ).not.toBeInTheDocument()
    expect(
      screen.queryByLabelText('settings.provider.api.options.anthropic_cache.cache_last_n')
    ).not.toBeInTheDocument()
    expect(
      screen.queryByLabelText('settings.provider.api.options.anthropic_cache.cache_system')
    ).not.toBeInTheDocument()
  })

  it('toggles gateway caching by writing the threshold as a bare enable flag', () => {
    isAnthropicSupportedProviderMock.mockReturnValue(false)
    useProviderMock.mockReturnValue({
      provider: { ...provider, id: 'gateway', presetProviderId: 'gateway' },
      updateProvider: updateProviderMock
    })

    render(<ProviderApiOptionsDrawer providerId="gateway" open onClose={vi.fn()} />)
    fireEvent.click(screen.getByLabelText('settings.provider.api.options.anthropic_cache.enable'))

    expect(updateProviderMock).toHaveBeenCalledWith({
      providerSettings: {
        ...provider.settings,
        cacheControl: {
          enabled: false,
          tokenThreshold: 0,
          cacheSystemMessage: true,
          cacheLastNMessages: 2
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
