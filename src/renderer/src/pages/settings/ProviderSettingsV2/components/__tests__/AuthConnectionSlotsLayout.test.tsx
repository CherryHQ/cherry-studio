import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import AuthConnectionSlotsLayout from '../AuthConnectionSlotsLayout'

vi.mock('../ProviderSpecificSettings', () => ({
  default: ({ placement }: any) => <div>{placement}</div>
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

describe('AuthConnectionSlotsLayout', () => {
  it('renders the default heading, provider-specific slots, and core content in order', () => {
    const { container } = render(
      <AuthConnectionSlotsLayout providerId="openai">
        <div>core</div>
      </AuthConnectionSlotsLayout>
    )
    const text = container.textContent ?? ''

    expect(text).toContain('settings.provider.auth_connection_section')
    expect(text).toContain('beforeAuth')
    expect(text).toContain('core')
    expect(text).toContain('afterAuth')
    expect(text.indexOf('beforeAuth')).toBeLessThan(text.indexOf('settings.provider.auth_connection_section'))
    expect(text.indexOf('settings.provider.auth_connection_section')).toBeLessThan(text.indexOf('core'))
    expect(text.indexOf('core')).toBeLessThan(text.indexOf('afterAuth'))
  })

  it('renders the core content when the title is omitted', () => {
    const { container } = render(
      <AuthConnectionSlotsLayout providerId="openai">
        <div>core-only</div>
      </AuthConnectionSlotsLayout>
    )

    expect(container.textContent).toContain('core-only')
    expect(container.querySelector('[aria-labelledby="provider-auth-connection-heading"]')).not.toBeNull()
  })
})
