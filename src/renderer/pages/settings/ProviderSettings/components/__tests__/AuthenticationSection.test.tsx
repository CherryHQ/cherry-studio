import { fireEvent, render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import AuthenticationSection from '@renderer/pages/settings/ProviderSettings/ConnectionSettings/AuthenticationSection'

const useProviderMock = vi.fn()
const useProviderApiKeyMock = vi.fn()
const useProviderConnectionCheckMock = vi.fn()
const apiKeyPropsSpy = vi.fn()
const apiHostPropsSpy = vi.fn()
const providerConnectionCheckDrawerPropsSpy = vi.fn()
const providerSpecificSettingsPropsSpy = vi.fn()
const openConnectionCheckMock = vi.fn()

vi.mock('@cherrystudio/ui', async (importOriginal) => {
  const actual = await importOriginal<object>()

  return {
    ...actual,
    Button: ({ children, onClick, ...props }: any) => (
      <button type="button" onClick={onClick} {...props}>
        {children}
      </button>
    )
  }
})

vi.mock('@renderer/hooks/useProvider', () => ({
  useProvider: (...args: any[]) => useProviderMock(...args)
}))

vi.mock('../../hooks/providerSetting/useProviderConnectionCheck', () => ({
  useProviderConnectionCheck: (...args: any[]) => useProviderConnectionCheckMock(...args)
}))

vi.mock('../../hooks/providerSetting/useProviderApiKey', () => ({
  useProviderApiKey: (...args: any[]) => useProviderApiKeyMock(...args)
}))

vi.mock('../../ConnectionSettings/ApiKey', () => ({
  default: (props: any) => {
    apiKeyPropsSpy(props)
    return (
      <button type="button" onClick={props.onOpenConnectionCheck}>
        api-key
      </button>
    )
  }
}))

vi.mock('../../ConnectionSettings/ApiHost', () => ({
  default: (props: any) => {
    apiHostPropsSpy(props)
    return <div>api-host</div>
  }
}))

vi.mock('../../ConnectionSettings/ProviderConnectionCheckDrawer', () => ({
  default: (props: any) => {
    providerConnectionCheckDrawerPropsSpy(props)
    return props.open ? <div>provider-connection-check-drawer</div> : null
  }
}))

vi.mock('../../ProviderSpecific/ProviderSpecificSettings', () => ({
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
      connectionCheckOpen: false,
      checkableModels: [],
      checkableApiKeys: [],
      openConnectionCheck: openConnectionCheckMock,
      closeConnectionCheck: vi.fn(),
      startConnectionCheck: vi.fn(),
      checkApi: vi.fn()
    })
  })

  it('passes only minimal coordination props to child domains', () => {
    const openModelHealthCheck = vi.fn()
    const connectionError = { message: 'bad key' }
    useProviderConnectionCheckMock.mockReturnValue({
      apiKeyConnectivity: { status: 'failed', checking: false, error: connectionError },
      connectionCheckOpen: true,
      checkableModels: [{ id: 'openai::gpt-4o', name: 'GPT-4o' }],
      checkableApiKeys: ['sk-test'],
      openConnectionCheck: openConnectionCheckMock,
      closeConnectionCheck: vi.fn(),
      startConnectionCheck: vi.fn(),
      checkApi: vi.fn()
    })

    const { getByRole } = render(
      <AuthenticationSection providerId="openai" onOpenModelHealthCheck={openModelHealthCheck} />
    )

    expect(useProviderApiKeyMock).toHaveBeenCalledWith('openai')
    expect(useProviderConnectionCheckMock).toHaveBeenCalledWith('openai')
    expect(apiKeyPropsSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'openai',
        apiKeyConnectivity: { status: 'failed', checking: false, error: connectionError },
        onOpenConnectionCheck: openConnectionCheckMock,
        requiresApiKey: undefined
      })
    )
    expect(apiHostPropsSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'openai'
      })
    )
    expect(providerConnectionCheckDrawerPropsSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        open: true,
        apiKeys: ['sk-test'],
        connectionError,
        requiresApiKey: undefined,
        onOpenModelHealthCheck: openModelHealthCheck
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

    fireEvent.click(getByRole('button', { name: 'api-key' }))
    expect(openConnectionCheckMock).toHaveBeenCalled()
  })
})
