import type { Provider } from '@shared/data/types/provider'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ProviderCard } from '../ConfigCard'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

const provider = {
  id: 'anthropic',
  name: 'Anthropic'
} as Provider

function renderCard(options: { isCurrent?: boolean } = {}) {
  const onConfigure = vi.fn()
  const onToggleCurrent = vi.fn()
  render(
    <ProviderCard
      provider={provider}
      providerName="Anthropic"
      modelName="claude-sonnet-4-5"
      isCurrent={options.isCurrent ?? false}
      onConfigure={onConfigure}
      onToggleCurrent={onToggleCurrent}
    />
  )

  return {
    card: screen.getByRole('button', { name: /Anthropic/ }),
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

  it('toggles the provider with Enter and Space when the card has focus', () => {
    const { card, onToggleCurrent } = renderCard()

    fireEvent.keyDown(card, { key: 'Enter' })
    fireEvent.keyDown(card, { key: ' ' })

    expect(onToggleCurrent).toHaveBeenCalledTimes(2)
    expect(onToggleCurrent).toHaveBeenNthCalledWith(1, provider)
    expect(onToggleCurrent).toHaveBeenNthCalledWith(2, provider)
  })
})
