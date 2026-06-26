import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import TranslateButton from '../TranslateButton'

const mocks = vi.hoisted(() => ({
  getLabel: vi.fn(),
  translateInputText: vi.fn()
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

vi.mock('@renderer/hooks/translate/useTranslateLanguages', () => ({
  useLanguages: () => ({
    getLabel: mocks.getLabel,
    languages: [{ langCode: 'en-us', value: 'English', emoji: 'US' }]
  })
}))

vi.mock('@renderer/utils/translate', () => ({
  translateInputText: mocks.translateInputText
}))

describe('TranslateButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getLabel.mockReturnValue('English')
  })

  it('keeps its own translation busy state when external loading clears', async () => {
    let resolveTranslation: (value: string) => void = () => {}
    mocks.translateInputText.mockImplementation(({ onConfirmed }) => {
      onConfirmed?.()
      return new Promise<string>((resolve) => {
        resolveTranslation = resolve
      })
    })

    const onTranslated = vi.fn()
    const { rerender } = render(<TranslateButton text="hello" onTranslated={onTranslated} isLoading={false} />)

    const button = screen.getByRole('button')
    fireEvent.click(button)

    expect(button).toBeDisabled()
    expect(button.querySelector('.animate-spin')).toBeInTheDocument()

    rerender(<TranslateButton text="hello" onTranslated={onTranslated} isLoading />)
    rerender(<TranslateButton text="hello" onTranslated={onTranslated} isLoading={false} />)

    expect(button).toBeDisabled()
    expect(button.querySelector('.animate-spin')).toBeInTheDocument()

    await act(async () => {
      resolveTranslation('bonjour')
    })

    await vi.waitFor(() => {
      expect(onTranslated).toHaveBeenCalledWith('bonjour')
    })
    expect(button).not.toBeDisabled()
  })

  it('derives disabled and spinner state from external loading', () => {
    const { rerender } = render(<TranslateButton text="hello" onTranslated={vi.fn()} isLoading />)

    const button = screen.getByRole('button')
    expect(button).toBeDisabled()
    expect(button.querySelector('.animate-spin')).toBeInTheDocument()

    rerender(<TranslateButton text="hello" onTranslated={vi.fn()} isLoading={false} />)

    expect(button).not.toBeDisabled()
    expect(button.querySelector('.animate-spin')).not.toBeInTheDocument()
  })
})
