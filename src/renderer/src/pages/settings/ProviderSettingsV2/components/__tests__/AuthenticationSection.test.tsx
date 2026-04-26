import { fireEvent, render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import AuthenticationSection from '../AuthenticationSection'

const useProviderMock = vi.fn()
const useProviderApiKeyMock = vi.fn()
const useProviderConnectionCheckMock = vi.fn()
const apiKeyPropsSpy = vi.fn()
const apiHostPropsSpy = vi.fn()
const apiActionsPropsSpy = vi.fn()
const providerSpecificSettingsPropsSpy = vi.fn()
const checkApiMock = vi.fn()

vi.mock('@cherrystudio/ui', async (importOriginal) => {
  const actual = await importOriginal<any>()

  return {
    ...actual,
    Button: ({ children, onClick, ...props }: any) => (
      <button type="button" onClick={onClick} {...props}>
        {children}
      </button>
    )
  }
})

vi.mock('@renderer/hooks/useProviders', () => ({
  useProvider: (...args: any[]) => useProviderMock(...args)
}))

vi.mock('../../hooks/providerSetting/useProviderConnectionCheck', () => ({
  useProviderConnectionCheck: (...args: any[]) => useProviderConnectionCheckMock(...args)
}))

vi.mock('../../hooks/providerSetting/useProviderApiKey', () => ({
  useProviderApiKey: (...args: any[]) => useProviderApiKeyMock(...args)
}))

vi.mock('../ApiKey', () => ({
  default: (props: any) => {
    apiKeyPropsSpy(props)
    return <div>api-key</div>
  }
}))

vi.mock('../ApiHost', () => ({
  default: (props: any) => {
    apiHostPropsSpy(props)
    return <div>api-host</div>
  }
}))

vi.mock('../ApiActions', () => ({
  default: (props: any) => {
    apiActionsPropsSpy(props)
    return (
      <button type="button" onClick={props.onCheckConnection}>
        check-connection
      </button>
    )
  }
}))

vi.mock('../ProviderSpecificSettings', () => ({
  default: (props: any) => {
    providerSpecificSettingsPropsSpy(props)
    return <div>{`provider-specific-${props.placement}`}</div>
  }
}))

describe('AuthenticationSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useProviderMock.mockReturnValue({
      provider: { id: 'openai', isEnabled: true, name: 'openai' }
    })
    useProviderApiKeyMock.mockReturnValue({
      serverApiKey: 'server-key',
      inputApiKey: 'draft-key',
      setInputApiKey: vi.fn(),
      hasPendingSync: false,
      commitInputApiKeyNow: vi.fn()
    })
    useProviderConnectionCheckMock.mockReturnValue({
      apiKeyConnectivity: { status: 'not_checked', checking: false },
      checkApi: checkApiMock,
      showApiKeyError: vi.fn()
    })
  })

  it('keeps authentication section wiring thin and providerId-driven', () => {
    const provider = { id: 'openai', isEnabled: true, name: 'openai' }
    useProviderMock.mockReturnValue({ provider })

    render(<AuthenticationSection providerId="openai" />)

    expect(useProviderApiKeyMock).toHaveBeenCalledWith('openai')
    expect(useProviderConnectionCheckMock).toHaveBeenCalledWith('openai')
  })

  it('passes only minimal coordination props to child domains', () => {
    const showApiKeyError = vi.fn()
    useProviderConnectionCheckMock.mockReturnValue({
      apiKeyConnectivity: { status: 'failed', checking: false },
      checkApi: checkApiMock,
      showApiKeyError
    })

    const { getByRole } = render(<AuthenticationSection providerId="openai" />)

    expect(apiKeyPropsSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'openai',
        apiKeyConnectivity: { status: 'failed', checking: false },
        onShowApiKeyError: showApiKeyError
      })
    )
    expect(apiHostPropsSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'openai'
      })
    )
    expect(apiActionsPropsSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'openai',
        onCheckConnection: expect.any(Function)
      })
    )
    expect(providerSpecificSettingsPropsSpy).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ providerId: 'openai', placement: 'beforeAuth' })
    )
    expect(providerSpecificSettingsPropsSpy).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ providerId: 'openai', placement: 'afterAuth' })
    )

    fireEvent.click(getByRole('button', { name: 'check-connection' }))
    expect(checkApiMock).toHaveBeenCalled()
  })

  it('still renders the same provider-specific slots for copilot', () => {
    useProviderMock.mockReturnValue({
      provider: { id: 'copilot', isEnabled: true, name: 'copilot' }
    })

    render(<AuthenticationSection providerId="copilot" />)

    expect(apiKeyPropsSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'copilot'
      })
    )
  })

  it('returns nothing when the provider is missing', () => {
    useProviderMock.mockReturnValue({
      provider: undefined
    })

    const { container } = render(<AuthenticationSection providerId="missing" />)

    expect(container).toBeEmptyDOMElement()
  })
})
