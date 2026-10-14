import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Provider } from '@shared/data/types/provider'
import { CLI_API_GATEWAY_PROVIDER_ID } from '@shared/types/codeCli'

import { ProviderCard } from '../ConfigCard'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@cherrystudio/ui/icons', () => {
  const ProviderIcon = ({ id }: { id: string }) => <span data-testid={`provider-icon-${id}`} />
  return {
    resolveProviderIconRef: (id: string) =>
      id === 'anthropic' ? { kind: 'provider', key: id, meta: { id, colorPrimary: '#000' } } : undefined,
    useIcon: (ref: { key: string } | undefined) => {
      if (!ref) return undefined
      const Icon = () => <ProviderIcon id={ref.key} />
      return Icon
    }
  }
})

const provider = {
  id: 'anthropic',
  name: 'Anthropic'
} as Provider

function renderCard(options: { isCurrent?: boolean; modelName?: string; actionsDisabled?: boolean } = {}) {
  const onMoveToTop = vi.fn()
  const onConfigure = vi.fn()
  const onToggleCurrent = vi.fn()
  const isCurrent = options.isCurrent ?? false
  const modelName = 'modelName' in options ? options.modelName : 'claude-sonnet-4-5'
  render(
    <ProviderCard
      provider={provider}
      providerName="Anthropic"
      modelName={modelName}
      isCurrent={isCurrent}
      actionsDisabled={options.actionsDisabled}
      onMoveToTop={onMoveToTop}
      onConfigure={onConfigure}
      onToggleCurrent={onToggleCurrent}
    />
  )

  const enableButton = screen.getByRole('button', { name: isCurrent ? 'code.disable' : 'code.enable' })
  return {
    enableButton,
    cardShell: enableButton.closest('.rounded-xl') as HTMLElement,
    configureButton: screen.getByRole('button', { name: 'code.configure' }),
    moveToTopButton: screen.getByRole('button', { name: 'code.move_provider_to_top' }),
    onMoveToTop,
    onConfigure,
    onToggleCurrent
  }
}

describe('ProviderCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('enables an inactive provider when the Enable button is clicked', () => {
    const { enableButton, onToggleCurrent } = renderCard()

    fireEvent.click(enableButton)

    expect(onToggleCurrent).toHaveBeenCalledWith(provider)
  })

  it('toggles off the active provider when the Disable button is clicked', () => {
    const { enableButton, onToggleCurrent } = renderCard({ isCurrent: true })

    fireEvent.click(enableButton)

    expect(onToggleCurrent).toHaveBeenCalledWith(provider)
  })

  it('does not toggle the provider when the card body is clicked', () => {
    const { cardShell, onToggleCurrent } = renderCard()

    fireEvent.click(cardShell)

    expect(onToggleCurrent).not.toHaveBeenCalled()
  })

  it('opens configuration without toggling the provider', () => {
    const { configureButton, onConfigure, onToggleCurrent } = renderCard()

    fireEvent.click(configureButton)

    expect(onConfigure).toHaveBeenCalledWith(provider)
    expect(onToggleCurrent).not.toHaveBeenCalled()
  })

  it('prevents provider changes while its managed runtime is active', () => {
    const { configureButton, enableButton, onConfigure, onToggleCurrent } = renderCard({ actionsDisabled: true })

    expect(configureButton).toBeDisabled()
    expect(enableButton).toBeDisabled()
    fireEvent.click(configureButton)
    fireEvent.click(enableButton)
    expect(onConfigure).not.toHaveBeenCalled()
    expect(onToggleCurrent).not.toHaveBeenCalled()
  })

  it('moves the provider to the top from the icon button before Configure', () => {
    const { moveToTopButton, onMoveToTop, onConfigure, onToggleCurrent } = renderCard()

    fireEvent.click(moveToTopButton)

    expect(onMoveToTop).toHaveBeenCalledWith(provider)
    expect(onConfigure).not.toHaveBeenCalled()
    expect(onToggleCurrent).not.toHaveBeenCalled()
  })

  it('labels the toggle button Enable when inactive and Disable when active', () => {
    const { unmount } = render(
      <ProviderCard
        provider={provider}
        providerName="Anthropic"
        isCurrent={false}
        onConfigure={vi.fn()}
        onToggleCurrent={vi.fn()}
      />
    )
    expect(screen.getByText('code.enable')).toBeInTheDocument()
    expect(screen.queryByText('code.disable')).not.toBeInTheDocument()
    unmount()

    render(
      <ProviderCard
        provider={provider}
        providerName="Anthropic"
        isCurrent
        onConfigure={vi.fn()}
        onToggleCurrent={vi.fn()}
      />
    )
    expect(screen.getByText('code.disable')).toBeInTheDocument()
    expect(screen.queryByText('code.enable')).not.toBeInTheDocument()
  })

  it('shows the provider name without model details when no model is configured', () => {
    renderCard({ modelName: undefined })

    expect(screen.getByText('Anthropic')).toBeInTheDocument()
    expect(screen.queryByText('settings.models.empty')).not.toBeInTheDocument()
    expect(screen.queryByText('｜')).not.toBeInTheDocument()
    expect(screen.queryByText('claude-sonnet-4-5')).not.toBeInTheDocument()
  })

  it('toggles the provider with Enter and Space when the Enable button has focus', async () => {
    const user = userEvent.setup()
    const { enableButton, onToggleCurrent } = renderCard()

    enableButton.focus()
    await user.keyboard('{Enter}')
    await user.keyboard(' ')

    expect(onToggleCurrent).toHaveBeenCalledTimes(2)
    expect(onToggleCurrent).toHaveBeenNthCalledWith(1, provider)
    expect(onToggleCurrent).toHaveBeenNthCalledWith(2, provider)
  })
})

describe('ProviderCard — unified gateway', () => {
  const gatewayProvider = { id: CLI_API_GATEWAY_PROVIDER_ID, name: '统一网关' } as Provider

  function renderGateway(description?: string) {
    return render(
      <ProviderCard
        provider={gatewayProvider}
        providerName="统一网关"
        description={description}
        isCurrent={false}
        onConfigure={vi.fn()}
        onToggleCurrent={vi.fn()}
      />
    )
  }

  it('renders the promo description when supplied', () => {
    renderGateway('一个网关，连通所有模型')

    expect(screen.getByText('一个网关，连通所有模型')).toBeInTheDocument()
  })

  it('omits the description row when no description is supplied', () => {
    renderGateway(undefined)

    expect(screen.queryByText('一个网关，连通所有模型')).not.toBeInTheDocument()
  })
})
