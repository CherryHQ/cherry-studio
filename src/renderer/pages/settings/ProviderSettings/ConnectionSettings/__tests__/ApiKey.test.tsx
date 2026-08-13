import '@testing-library/jest-dom/vitest'

import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ApiKey from '../ApiKey'

const useProviderMock = vi.fn()
const useProviderMetaMock = vi.fn()
const useAuthenticationApiKeyMock = vi.fn()

vi.mock('@cherrystudio/ui', () => ({
  InputGroup: ({ children }: any) => <div>{children}</div>,
  InputGroupAddon: ({ children }: any) => <span>{children}</span>,
  InputGroupInput: (props: any) => <input {...props} />,
  Tooltip: ({ children }: any) => <>{children}</>
}))

vi.mock('@renderer/hooks/useProvider', () => ({
  useProvider: (...args: any[]) => useProviderMock(...args)
}))

vi.mock('../../hooks/providerSetting/useProviderMeta', () => ({
  useProviderMeta: (...args: any[]) => useProviderMetaMock(...args)
}))

vi.mock('../../hooks/providerSetting/useAuthenticationApiKey', () => ({
  useAuthenticationApiKey: (...args: any[]) => useAuthenticationApiKeyMock(...args)
}))

vi.mock('../ProviderApiKeyListDrawer', () => ({
  default: () => null
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

describe('ApiKey', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useProviderMock.mockReturnValue({
      provider: { id: 'openai', name: 'OpenAI' }
    })
    useProviderMetaMock.mockReturnValue({
      isApiKeyFieldVisible: true,
      apiKeyWebsite: undefined,
      isDmxapi: false
    })
    useAuthenticationApiKeyMock.mockReturnValue({
      inputApiKey: '',
      setInputApiKey: vi.fn(),
      hasPendingSync: false,
      commitInputApiKeyNow: vi.fn()
    })
  })

  it('keeps key management but removes the duplicate model-check entry', () => {
    render(<ApiKey providerId="openai" />)

    expect(screen.getByRole('button', { name: 'settings.provider.api.key.list.title' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'settings.provider.check' })).not.toBeInTheDocument()
  })
})
