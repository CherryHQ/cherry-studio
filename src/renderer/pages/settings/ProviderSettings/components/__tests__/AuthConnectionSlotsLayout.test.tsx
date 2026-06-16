import AuthConnectionSlotsLayout from '@renderer/pages/settings/ProviderSettings/ConnectionSettings/AuthConnectionSlotsLayout'
import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: '3rdParty', init: () => {} }
}))

vi.mock('../../ProviderSpecific/ProviderSpecificSettings', () => ({
  default: ({ placement }: any) => <div>{placement}</div>
}))

describe('AuthConnectionSlotsLayout', () => {
  it('renders provider-specific slots and core content in order', () => {
    const { container } = render(
      <AuthConnectionSlotsLayout providerId="openai">
        <div>core</div>
      </AuthConnectionSlotsLayout>
    )
    const text = container.textContent ?? ''

    expect(text).toContain('beforeAuth')
    expect(text).toContain('core')
    expect(text).toContain('afterAuth')
    expect(text.indexOf('beforeAuth')).toBeLessThan(text.indexOf('core'))
    expect(text.indexOf('core')).toBeLessThan(text.indexOf('afterAuth'))
  })

  it('renders core content inside the shell card', () => {
    const { container } = render(
      <AuthConnectionSlotsLayout providerId="openai">
        <div>core-only</div>
      </AuthConnectionSlotsLayout>
    )

    expect(container.textContent).toContain('core-only')
    expect(container.querySelector('section')).not.toBeNull()
  })

  it('renders the connection section heading', () => {
    const { container } = render(
      <AuthConnectionSlotsLayout providerId="openai">
        <div>core</div>
      </AuthConnectionSlotsLayout>
    )

    const heading = container.querySelector('h2')
    expect(heading).not.toBeNull()
    expect(heading?.textContent).toBe('settings.provider.connection_title')
  })
})
