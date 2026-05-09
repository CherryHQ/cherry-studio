import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import AwsBedrockSettings from '../../ProviderSpecific/AwsBedrockSettings'

const updateAuthConfigMock = vi.fn()
const useProviderMock = vi.fn()
const useProviderAuthConfigMock = vi.fn()
const useProviderPresetMetadataMock = vi.fn()
const setInputApiKeyMock = vi.fn()
const commitInputApiKeyNowMock = vi.fn()

vi.mock('@cherrystudio/ui', () => ({
  Input: (props: any) => <input {...props} />,
  Label: ({ children, ...props }: any) => <label {...props}>{children}</label>,
  RadioGroup: ({ children }: any) => <div>{children}</div>,
  RadioGroupItem: (props: any) => <input type="radio" {...props} />,
  RowFlex: ({ children }: any) => <div>{children}</div>
}))

vi.mock('../../shared/primitives/ProviderSettingsPrimitives', () => ({
  ProviderHelpLink: ({ children, ...props }: any) => <a {...props}>{children}</a>,
  ProviderHelpText: ({ children }: any) => <span>{children}</span>,
  ProviderHelpTextRow: ({ children }: any) => <div>{children}</div>,
  ProviderSettingsSubtitle: ({ children }: any) => <div>{children}</div>
}))

vi.mock('@renderer/hooks/useProviders', () => ({
  useProvider: (...args: any[]) => useProviderMock(...args),
  useProviderAuthConfig: (...args: any[]) => useProviderAuthConfigMock(...args),
  useProviderPresetMetadata: (...args: any[]) => useProviderPresetMetadataMock(...args)
}))

vi.mock('../../hooks/providerSetting/useAuthenticationApiKey', () => ({
  useAuthenticationApiKey: () => ({
    inputApiKey: 'bedrock-api-key',
    setInputApiKey: setInputApiKeyMock,
    commitInputApiKeyNow: commitInputApiKeyNowMock
  })
}))

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

describe('AwsBedrockSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useProviderPresetMetadataMock.mockReturnValue({ data: { websites: {} } })
    useProviderAuthConfigMock.mockReturnValue({ data: null })
  })

  it('shows IAM credentials when authType is iam-aws', () => {
    useProviderMock.mockReturnValue({
      provider: { id: 'aws-bedrock', authType: 'iam-aws' },
      updateAuthConfig: updateAuthConfigMock
    })
    useProviderAuthConfigMock.mockReturnValue({
      data: { type: 'iam-aws', region: 'us-east-1', accessKeyId: 'access-key', secretAccessKey: 'secret-key' }
    })

    render(<AwsBedrockSettings providerId="aws-bedrock" />)

    expect(screen.getByDisplayValue('access-key')).toBeInTheDocument()
    expect(screen.getByDisplayValue('secret-key')).toBeInTheDocument()
    expect(screen.queryByDisplayValue('bedrock-api-key')).not.toBeInTheDocument()
  })

  it('shows and persists API key when authType is api-key', () => {
    useProviderMock.mockReturnValue({
      provider: { id: 'aws-bedrock', authType: 'api-key' },
      updateAuthConfig: updateAuthConfigMock
    })

    render(<AwsBedrockSettings providerId="aws-bedrock" />)

    const input = screen.getByDisplayValue('bedrock-api-key')
    fireEvent.change(input, { target: { value: 'next-key' } })
    fireEvent.blur(input)

    expect(setInputApiKeyMock).toHaveBeenCalledWith('next-key')
    expect(commitInputApiKeyNowMock).toHaveBeenCalled()
  })
})
