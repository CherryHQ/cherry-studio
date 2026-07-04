import type { Provider } from '@shared/data/types/provider'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ProviderCard } from '../ConfigCard'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@cherrystudio/ui/icons', () => ({
  resolveProviderIcon: (id: string) =>
    id === 'anthropic' ? () => <span data-testid={`provider-icon-${id}`} /> : undefined
}))

const provider = {
  id: 'anthropic',
  name: 'Anthropic'
} as Provider

function renderCard(options: { isCurrent?: boolean; modelName?: string } = {}) {
  const onConfigure = vi.fn()
  const onToggleCurrent = vi.fn()
  const modelName = 'modelName' in options ? options.modelName : 'claude-sonnet-4-5'
  render(
    <ProviderCard
      provider={provider}
      providerName="Anthropic"
      modelName={modelName}
      isCurrent={options.isCurrent ?? false}
      onConfigure={onConfigure}
      onToggleCurrent={onToggleCurrent}
    />
  )

  return {
    card: screen.getByRole('button', { name: /Anthropic/ }),
    cardShell: screen.getByRole('button', { name: /Anthropic/ }).closest('.rounded-xl') as HTMLElement,
    configureButton: screen.getByRole('button', { name: 'code.configure' }),
    onConfigure,
    onToggleCurrent
  }
}

describe('ProviderCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('enables an inactive provider when the card is clicked', () => {
    const { card, onToggleCurrent } = renderCard()

    fireEvent.click(card)

    expect(onToggleCurrent).toHaveBeenCalledWith(provider)
  })

  it('toggles off the active provider when the current card is clicked', () => {
    const { card, onToggleCurrent } = renderCard({ isCurrent: true })

    fireEvent.click(card)

    expect(onToggleCurrent).toHaveBeenCalledWith(provider)
  })

  it('opens configuration without toggling the provider', () => {
    const { configureButton, onConfigure, onToggleCurrent } = renderCard()

    fireEvent.click(configureButton)

    expect(onConfigure).toHaveBeenCalledWith(provider)
    expect(onToggleCurrent).not.toHaveBeenCalled()
  })

  it('removes the enable and disable button text while keeping the active badge', () => {
    renderCard({ isCurrent: true })

    expect(screen.getByText('code.enabled')).toBeInTheDocument()
    expect(screen.queryByText('code.enable')).not.toBeInTheDocument()
    expect(screen.queryByText('code.disable')).not.toBeInTheDocument()
  })

  it('uses the same muted selection background as provider settings', () => {
    const { cardShell } = renderCard({ isCurrent: true })

    expect(cardShell).toHaveClass('bg-muted')
    expect(cardShell).not.toHaveClass('bg-success/[0.04]')
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

  it('toggles the provider with Enter and Space when the card has focus', async () => {
    const user = userEvent.setup()
    const { card, onToggleCurrent } = renderCard()

    card.focus()
    await user.keyboard('{Enter}')
    await user.keyboard(' ')

    expect(onToggleCurrent).toHaveBeenCalledTimes(2)
    expect(onToggleCurrent).toHaveBeenNthCalledWith(1, provider)
    expect(onToggleCurrent).toHaveBeenNthCalledWith(2, provider)
  })
})
