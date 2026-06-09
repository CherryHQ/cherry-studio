import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ProviderHeader from '../ProviderHeader'

const useProviderMock = vi.fn()
const useProviderMetaMock = vi.fn()
const useProviderEnableMock = vi.fn()
vi.mock('@cherrystudio/ui', () => {
  return {
    Switch: ({ checked, onCheckedChange }: any) => (
      <button type="button" data-checked={checked ? 'true' : 'false'} onClick={() => onCheckedChange(!checked)}>
        switch
      </button>
    ),
    Tooltip: ({ children, content }: any) => (
      <div>
        {children}
        <span>{content}</span>
      </div>
    ),
    Button: ({ asChild, children, onClick, ...props }: any) =>
      asChild ? (
        children
      ) : (
        <button type="button" onClick={onClick} {...props}>
          {children}
        </button>
      )
  }
})

vi.mock('../ProviderApiOptionsDrawer', () => ({
  default: ({ open }: { open: boolean }) => (open ? <div>api-options-drawer</div> : null)
}))

vi.mock('@renderer/pages/settings/ProviderSettings/components/ProviderAvatar', () => ({
  ProviderAvatar: () => <div>provider-avatar</div>
}))

vi.mock('@renderer/hooks/useProvider', () => ({
  useProvider: (...args: any[]) => useProviderMock(...args)
}))

vi.mock('../../hooks/providerSetting/useProviderMeta', () => ({
  useProviderMeta: (...args: any[]) => useProviderMetaMock(...args)
}))

vi.mock('../../hooks/providerSetting/useProviderEnable', () => ({
  useProviderEnable: (...args: any[]) => useProviderEnableMock(...args)
}))

describe('ProviderHeader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useProviderMock.mockReturnValue({
      provider: {
        id: 'openai',
        name: 'OpenAI',
        presetProviderId: 'openai',
        isEnabled: true
      }
    })
    useProviderMetaMock.mockReturnValue({
      fancyProviderName: 'OpenAI',
      docsWebsite: undefined,
      showApiOptionsButton: false
    })
    useProviderEnableMock.mockReturnValue({
      toggleProviderEnabled: vi.fn()
    })
  })

  it('does not show the provider id subtitle', () => {
    render(<ProviderHeader providerId="openai" />)

    expect(screen.getByText('OpenAI')).toBeInTheDocument()
    expect(screen.queryByText('openai')).not.toBeInTheDocument()
  })

  it('shows the custom provider name without the provider id subtitle', () => {
    useProviderMock.mockReturnValue({
      provider: {
        id: '35836b32-9bc1-40ab-9195-8b0b4ea3f342',
        name: '反反复',
        presetProviderId: undefined,
        isEnabled: true
      }
    })
    useProviderMetaMock.mockReturnValue({
      fancyProviderName: '反反复',
      docsWebsite: undefined,
      showApiOptionsButton: false
    })

    render(<ProviderHeader providerId="35836b32-9bc1-40ab-9195-8b0b4ea3f342" />)

    expect(screen.getByText('反反复')).toBeInTheDocument()
    expect(screen.queryByText('35836b32-9bc1-40ab-9195-8b0b4ea3f342')).not.toBeInTheDocument()
  })

  it('keeps the provider name as text and makes only the docs icon a link', () => {
    useProviderMetaMock.mockReturnValue({
      fancyProviderName: 'OpenAI',
      docsWebsite: 'https://platform.openai.com/docs',
      modelsWebsite: 'https://platform.openai.com/docs/models',
      showApiOptionsButton: false
    })

    render(<ProviderHeader providerId="openai" />)

    expect(screen.getByText('OpenAI').closest('a')).toBeNull()
    const docsLink = screen.getByRole('link', { name: 'OpenAI · common.docs' })
    expect(docsLink).toHaveAttribute('href', 'https://platform.openai.com/docs')
    expect(screen.queryByRole('link', { name: 'OpenAI · settings.models.list_title' })).not.toBeInTheDocument()
  })

  it('opens the api options drawer when the meta enables the entry', () => {
    useProviderMetaMock.mockReturnValue({
      fancyProviderName: 'OpenAI',
      docsWebsite: undefined,
      showApiOptionsButton: true
    })

    render(<ProviderHeader providerId="openai" />)

    fireEvent.click(screen.getByRole('button', { name: 'settings.provider.api.options.label' }))

    expect(screen.getByText('api-options-drawer')).toBeInTheDocument()
  })
})
