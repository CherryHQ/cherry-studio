import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import AwsBedrockSettings from '../../ProviderSpecific/AwsBedrockSettings'

const updateAuthConfigMock = vi.fn()
const useProviderMock = vi.fn()
const useProviderAuthConfigMock = vi.fn()
const setInputApiKeyMock = vi.fn()
const commitInputApiKeyNowMock = vi.fn()
const radioGroupPropsSpy = vi.fn()

vi.mock('@cherrystudio/ui', () => ({
  Button: ({ children, onClick, ...props }: any) => (
    <button type="button" onClick={onClick} {...props}>
      {children}
    </button>
  ),
  Input: (props: any) => <input {...props} />,
  Label: ({ children, ...props }: any) => <label {...props}>{children}</label>,
  // RadioGroup props are captured via spy so tests can drive onValueChange
  // directly. Simulating real radio change events in jsdom + an inline mock
  // is unreliable because the mock doesn't reflect group selection state.
  RadioGroup: (props: any) => {
    radioGroupPropsSpy(props)
    return <div>{props.children}</div>
  },
  RadioGroupItem: (props: any) => <input type="radio" {...props} />,
  RowFlex: ({ children }: any) => <div>{children}</div>
}))

vi.mock('../../primitives/ProviderSettingsPrimitives', () => ({
  ProviderHelpLink: ({ children, ...props }: any) => <a {...props}>{children}</a>,
  ProviderHelpText: ({ children }: any) => <span>{children}</span>,
  ProviderHelpTextRow: ({ children }: any) => <div>{children}</div>,
  ProviderSettingsSubtitle: ({ children }: any) => <div>{children}</div>
}))

vi.mock('@renderer/hooks/useProviders', () => ({
  useProvider: (...args: any[]) => useProviderMock(...args),
  useProviderAuthConfig: (...args: any[]) => useProviderAuthConfigMock(...args)
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
    radioGroupPropsSpy.mockClear()
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

  it('shows and persists API key when authType is api-key-aws', () => {
    useProviderMock.mockReturnValue({
      provider: { id: 'aws-bedrock', authType: 'api-key-aws' },
      updateAuthConfig: updateAuthConfigMock
    })
    useProviderAuthConfigMock.mockReturnValue({
      data: { type: 'api-key-aws', region: 'us-west-2' }
    })

    render(<AwsBedrockSettings providerId="aws-bedrock" />)

    const input = screen.getByDisplayValue('bedrock-api-key')
    fireEvent.change(input, { target: { value: 'next-key' } })
    fireEvent.blur(input)

    expect(setInputApiKeyMock).toHaveBeenCalledWith('next-key')
    expect(commitInputApiKeyNowMock).toHaveBeenCalled()
  })

  it('writes api-key-aws (with region carried over) when toggling to api-key mode', async () => {
    useProviderMock.mockReturnValue({
      provider: { id: 'aws-bedrock', authType: 'iam-aws' },
      updateAuthConfig: updateAuthConfigMock
    })
    useProviderAuthConfigMock.mockReturnValue({
      data: { type: 'iam-aws', region: 'us-east-2', accessKeyId: 'a', secretAccessKey: 's' }
    })

    render(<AwsBedrockSettings providerId="aws-bedrock" />)

    const { onValueChange } = radioGroupPropsSpy.mock.calls[0][0]
    await onValueChange('apiKey')

    expect(updateAuthConfigMock).toHaveBeenCalledWith({ type: 'api-key-aws', region: 'us-east-2' })
  })

  it('writes iam-aws (with region carried over) when toggling to iam mode', async () => {
    useProviderMock.mockReturnValue({
      provider: { id: 'aws-bedrock', authType: 'api-key-aws' },
      updateAuthConfig: updateAuthConfigMock
    })
    useProviderAuthConfigMock.mockReturnValue({
      data: { type: 'api-key-aws', region: 'us-west-2' }
    })

    render(<AwsBedrockSettings providerId="aws-bedrock" />)

    const { onValueChange } = radioGroupPropsSpy.mock.calls[0][0]
    await onValueChange('iam')

    expect(updateAuthConfigMock).toHaveBeenCalledWith({ type: 'iam-aws', region: 'us-west-2' })
  })
})
