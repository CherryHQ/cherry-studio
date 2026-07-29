import { useDirection } from '@cherrystudio/ui'
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { LanguageDirectionProvider } from '../LanguageDirectionProvider'

const { languageState } = vi.hoisted(() => ({
  languageState: { value: 'en-US' as 'ar-YE' | 'en-US' }
}))

vi.mock('@renderer/hooks/useLanguageSync', () => ({
  useLanguageSync: () => languageState.value
}))

function DirectionProbe(): React.ReactElement {
  const direction = useDirection()
  return <div data-direction={direction}>content</div>
}

describe('LanguageDirectionProvider', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('dir')
    document.documentElement.removeAttribute('lang')
  })

  it('provides and applies LTR direction', () => {
    languageState.value = 'en-US'

    render(
      <LanguageDirectionProvider>
        <DirectionProbe />
      </LanguageDirectionProvider>
    )

    expect(screen.getByText('content')).toHaveAttribute('data-direction', 'ltr')
    expect(document.documentElement).toHaveAttribute('lang', 'en-US')
    expect(document.documentElement).toHaveAttribute('dir', 'ltr')
  })

  it('provides and applies RTL direction', () => {
    languageState.value = 'ar-YE'

    render(
      <LanguageDirectionProvider>
        <DirectionProbe />
      </LanguageDirectionProvider>
    )

    expect(screen.getByText('content')).toHaveAttribute('data-direction', 'rtl')
    expect(document.documentElement).toHaveAttribute('lang', 'ar-YE')
    expect(document.documentElement).toHaveAttribute('dir', 'rtl')
  })
})
