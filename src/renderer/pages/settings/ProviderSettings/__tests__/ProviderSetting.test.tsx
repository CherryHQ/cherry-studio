import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ProviderSetting from '../ProviderSetting'

const useProviderMock = vi.fn()
const useProviderApiKeyMock = vi.fn()
const providerApiSetupModuleState = vi.hoisted(() => ({ loaded: false }))

vi.mock('@renderer/hooks/useTheme', () => ({
  useTheme: () => ({
    theme: 'light'
  })
}))

vi.mock('@renderer/hooks/useProvider', () => ({
  useProvider: (...args: any[]) => useProviderMock(...args)
}))

vi.mock('../hooks/providerSetting/useProviderApiKey', () => ({
  useProviderApiKey: (...args: any[]) => useProviderApiKeyMock(...args)
}))

vi.mock('../components/ProviderHeader', () => ({
  default: ({ providerId }: any) => <div>{`provider-header-${providerId}`}</div>
}))

vi.mock('../ConnectionSettings/AuthenticationSection', async () => {
  const { useAuthenticationApiKey } = await import('../hooks/providerSetting/useAuthenticationApiKey')

  function AuthenticationSectionMock({ providerId, onContinueApiSetup }: any) {
    const { inputApiKey } = useAuthenticationApiKey()
    return (
      <div>
        {`authentication-section-${providerId}-${inputApiKey}`}
        <button type="button" onClick={onContinueApiSetup}>
          continue-model-setup
        </button>
      </div>
    )
  }

  return {
    default: AuthenticationSectionMock
  }
})

vi.mock('../ConnectionSettings/ProviderApiSetupDialog', () => {
  providerApiSetupModuleState.loaded = true

  return {
    default: ({ initialStep }: any) => <div role="dialog" aria-label={`api-setup-${initialStep}`} />
  }
})

vi.mock('../ModelList', async () => {
  const { useAuthenticationApiKey } = await import('../hooks/providerSetting/useAuthenticationApiKey')

  function ModelListMock({ providerId }: any) {
    const { inputApiKey } = useAuthenticationApiKey()
    return <div>{`model-list-${providerId}-${inputApiKey}`}</div>
  }

  return {
    ModelList: ModelListMock,
    ModelListHealthProvider: ({ children }: any) => <>{children}</>
  }
})

describe('ProviderSetting', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useProviderMock.mockReturnValue({
      provider: { id: 'openai', isEnabled: false, name: 'openai' }
    })
    useProviderApiKeyMock.mockReturnValue({
      serverApiKey: 'server-key',
      inputApiKey: 'shared-draft-key',
      setInputApiKey: vi.fn(),
      hasPendingSync: true,
      commitInputApiKeyNow: vi.fn()
    })
  })

  it('loads API setup only when the user opens it', async () => {
    const user = userEvent.setup()

    render(<ProviderSetting providerId="openai" />)

    expect(providerApiSetupModuleState.loaded).toBe(false)

    await user.click(screen.getByRole('button', { name: 'continue-model-setup' }))

    expect(await screen.findByRole('dialog', { name: 'api-setup-models' })).toBeInTheDocument()
    expect(providerApiSetupModuleState.loaded).toBe(true)
  })

  it('shares one API-key draft between authentication and model settings', () => {
    render(<ProviderSetting providerId="openai" />)

    expect(screen.getByTestId('provider-detail-shell')).toBeInTheDocument()
    expect(screen.getByText('provider-header-openai')).toBeInTheDocument()
    expect(screen.getByText('authentication-section-openai-shared-draft-key')).toBeInTheDocument()
    expect(screen.getByText('model-list-openai-shared-draft-key')).toBeInTheDocument()
    expect(useProviderApiKeyMock).toHaveBeenCalledTimes(1)
    expect(useProviderApiKeyMock).toHaveBeenCalledWith('openai')
  })

  it('opens the requested setup step when a newly created provider is selected', () => {
    render(<ProviderSetting providerId="openai" initialApiSetupStep="models" />)

    expect(screen.getByRole('dialog', { name: 'api-setup-models' })).toBeInTheDocument()
  })

  it('opens model setup from the authentication action', async () => {
    const user = userEvent.setup()
    render(<ProviderSetting providerId="openai" />)

    await user.click(screen.getByRole('button', { name: 'continue-model-setup' }))

    expect(screen.getByRole('dialog', { name: 'api-setup-models' })).toBeInTheDocument()
  })

  it('renders nothing when the provider is missing', () => {
    useProviderMock.mockReturnValue({
      provider: undefined
    })

    const { container } = render(<ProviderSetting providerId="missing" />)

    expect(container).toBeEmptyDOMElement()
    expect(useProviderApiKeyMock).not.toHaveBeenCalled()
  })
})
