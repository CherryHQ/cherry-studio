import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import AuthConnectionSlotsLayout from '../AuthConnectionSlotsLayout'

vi.mock('../ProviderSpecificSettings', () => ({
  default: ({ placement }: any) => <div>{placement}</div>
}))

describe('AuthConnectionSlotsLayout', () => {
  it('renders the default heading, provider-specific slots, and core content in order', () => {
    const { container } = render(
      <AuthConnectionSlotsLayout providerId="openai">
        <div>core</div>
      </AuthConnectionSlotsLayout>
    )
    const text = container.textContent ?? ''

    expect(text).toContain('连接认证')
    expect(text).toContain('beforeAuth')
    expect(text).toContain('core')
    expect(text).toContain('afterAuth')
    expect(text.indexOf('连接认证')).toBeLessThan(text.indexOf('beforeAuth'))
    expect(text.indexOf('beforeAuth')).toBeLessThan(text.indexOf('core'))
    expect(text.indexOf('core')).toBeLessThan(text.indexOf('afterAuth'))
  })

  it('renders the core content when the title is omitted', () => {
    const { container } = render(
      <AuthConnectionSlotsLayout providerId="openai">
        <div>core-only</div>
      </AuthConnectionSlotsLayout>
    )

    expect(container.textContent).toContain('core-only')
    expect(container.querySelector('[aria-label=\"provider-connection-sections\"]')).not.toBeNull()
  })
})
