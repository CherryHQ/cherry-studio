import type { Provider } from '@shared/data/types/provider'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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

function renderCard(options: { isCurrent?: boolean; modelName?: string } = {}) {
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
      onConfigure={onConfigure}
      onToggleCurrent={onToggleCurrent}
    />
  )

  const enableButton = screen.getByRole('button', { name: isCurrent ? 'code.disable' : 'code.enable' })
  return {
    enableButton,
    cardShell: enableButton.closest('.rounded-xl') as HTMLElement,
    configureButton: screen.getByRole('button', { name: 'code.configure' }),
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

  it('renders the disable action as a soft destructive button', () => {
    const { enableButton } = renderCard({ isCurrent: true })

    expect(enableButton.className).not.toMatch(/\bbg-destructive(?:\s|$)/)
    expect(enableButton).toHaveClass('bg-destructive/10')
    expect(enableButton).toHaveClass('text-destructive')
  })

  it('uses a subtle primary tint as the selection background', () => {
    const { cardShell } = renderCard({ isCurrent: true })

    expect(cardShell).toHaveClass('bg-primary/5')
    expect(cardShell).not.toHaveClass('bg-muted')
  })

  it('marks the enabled provider with a primary border', () => {
    const { cardShell } = renderCard({ isCurrent: true })

    expect(cardShell).toHaveClass('border-primary')
  })

  it('renders the provider icon before the provider name', () => {
    renderCard()

    const icon = screen.getByTestId('provider-icon-anthropic')
    const name = screen.getByText('Anthropic')

    expect(icon.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('renders provider name and model id in one row separated by a bar', () => {
    renderCard()

    const name = screen.getByText('Anthropic')
    const separator = screen.getByText('｜')
    const modelId = screen.getByText('claude-sonnet-4-5')

    expect(name.compareDocumentPosition(separator) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(separator.compareDocumentPosition(modelId) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(name.parentElement).toContainElement(separator)
    expect(name.parentElement).toContainElement(modelId)
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
