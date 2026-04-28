import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ProviderSpecificSettings from '../ProviderSpecificSettings'

const useProviderMock = vi.fn()
const useProviderMetaMock = vi.fn()
const isProviderSupportAuthMock = vi.fn()

vi.mock('@renderer/hooks/useProviders', () => ({
  useProvider: (...args: any[]) => useProviderMock(...args)
}))

vi.mock('../../hooks/providerSetting/useProviderMeta', () => ({
  useProviderMeta: (...args: any[]) => useProviderMetaMock(...args)
}))

vi.mock('@renderer/pages/settings/ProviderSettingsV2/utils/provider', () => ({
  isProviderSupportAuth: (...args: any[]) => isProviderSupportAuthMock(...args)
}))

vi.mock('../OpenAIAlert', () => ({
  default: () => <div>openai-alert</div>
}))

vi.mock('@renderer/pages/settings/ProviderSettingsV2/ProviderOAuth', () => ({
  default: ({ providerId }: any) => <div>{`provider-oauth-${providerId}`}</div>
}))

vi.mock('@renderer/pages/settings/ProviderSettingsV2/CherryINOAuth', () => ({
  default: ({ providerId }: any) => <div>{`cherryin-oauth-${providerId}`}</div>
}))

vi.mock('@renderer/pages/settings/ProviderSettingsV2/DMXAPISettings', () => ({
  default: ({ providerId }: any) => <div>{`dmxapi-settings-${providerId}`}</div>
}))

vi.mock('@renderer/pages/settings/ProviderSettingsV2/OVMSSettings', () => ({
  default: () => <div>ovms-settings</div>
}))

vi.mock('../AnthropicAuthSection', () => ({
  default: ({ providerId }: any) => <div>{`anthropic-auth-${providerId}`}</div>
}))

vi.mock('@renderer/pages/settings/ProviderSettingsV2/LMStudioSettings', () => ({
  default: ({ providerId }: any) => <div>{`lmstudio-settings-${providerId}`}</div>
}))

vi.mock('@renderer/pages/settings/ProviderSettingsV2/GPUStackSettings', () => ({
  default: ({ providerId }: any) => <div>{`gpustack-settings-${providerId}`}</div>
}))

vi.mock('@renderer/pages/settings/ProviderSettingsV2/GithubCopilotSettings', () => ({
  default: ({ providerId }: any) => <div>{`copilot-settings-${providerId}`}</div>
}))

vi.mock('@renderer/pages/settings/ProviderSettingsV2/AwsBedrockSettings', () => ({
  default: ({ providerId }: any) => <div>{`aws-bedrock-settings-${providerId}`}</div>
}))

vi.mock('@renderer/pages/settings/ProviderSettingsV2/VertexAISettings', () => ({
  default: ({ providerId }: any) => <div>{`vertexai-settings-${providerId}`}</div>
}))

describe('ProviderSpecificSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useProviderMetaMock.mockReturnValue({
      isCherryIN: false,
      isDmxapi: false
    })
    isProviderSupportAuthMock.mockReturnValue(false)
  })

  it('renders beforeAuth blocks in stable registry order', () => {
    useProviderMock.mockReturnValue({
      provider: { id: 'openai', name: 'openai', isEnabled: true }
    })
    isProviderSupportAuthMock.mockReturnValue(true)

    const { container } = render(<ProviderSpecificSettings providerId="openai" placement="beforeAuth" />)
    const text = container.textContent ?? ''

    expect(text).toContain('provider-oauth-openai')
    expect(text).toContain('openai-alert')
    expect(text.indexOf('provider-oauth-openai')).toBeLessThan(text.indexOf('openai-alert'))
  })

  it.each([
    {
      providerId: 'cherryin',
      placement: 'beforeAuth' as const,
      meta: { isCherryIN: true, isDmxapi: false },
      expectedText: 'cherryin-oauth-cherryin'
    },
    {
      providerId: 'dmxapi',
      placement: 'beforeAuth' as const,
      meta: { isCherryIN: false, isDmxapi: true },
      expectedText: 'dmxapi-settings-dmxapi'
    },
    {
      providerId: 'anthropic',
      placement: 'beforeAuth' as const,
      meta: { isCherryIN: false, isDmxapi: false },
      expectedText: 'anthropic-auth-anthropic'
    },
    {
      providerId: 'ovms',
      placement: 'beforeAuth' as const,
      meta: { isCherryIN: false, isDmxapi: false },
      expectedText: 'ovms-settings'
    },
    {
      providerId: 'lmstudio',
      placement: 'afterAuth' as const,
      meta: { isCherryIN: false, isDmxapi: false },
      expectedText: 'lmstudio-settings-lmstudio'
    },
    {
      providerId: 'gpustack',
      placement: 'afterAuth' as const,
      meta: { isCherryIN: false, isDmxapi: false },
      expectedText: 'gpustack-settings-gpustack'
    },
    {
      providerId: 'copilot',
      placement: 'afterAuth' as const,
      meta: { isCherryIN: false, isDmxapi: false },
      expectedText: 'copilot-settings-copilot'
    },
    {
      providerId: 'aws-bedrock',
      placement: 'afterAuth' as const,
      meta: { isCherryIN: false, isDmxapi: false },
      expectedText: 'aws-bedrock-settings-aws-bedrock'
    },
    {
      providerId: 'vertexai',
      placement: 'afterAuth' as const,
      meta: { isCherryIN: false, isDmxapi: false },
      expectedText: 'vertexai-settings-vertexai'
    }
  ])(
    'renders the expected provider-specific block for $providerId',
    ({ providerId, placement, meta, expectedText }) => {
      useProviderMock.mockReturnValue({
        provider: { id: providerId, name: providerId, isEnabled: true }
      })
      useProviderMetaMock.mockReturnValue(meta)

      render(<ProviderSpecificSettings providerId={providerId} placement={placement} />)

      expect(screen.getByText(expectedText)).toBeInTheDocument()
    }
  )

  it('returns nothing when the provider is missing', () => {
    useProviderMock.mockReturnValue({
      provider: undefined
    })

    const { container } = render(<ProviderSpecificSettings providerId="missing" placement="beforeAuth" />)

    expect(container).toBeEmptyDOMElement()
  })
})
