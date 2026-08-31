import '@testing-library/jest-dom/vitest'

import type { UpdateOffer } from '@renderer/hooks/useMiniAppUpdate'
import i18n from '@renderer/i18n/resolver'
import { render, screen } from '@testing-library/react'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { UpdateReviewCard } from '../UpdateReviewCard'

const ready = (over: Partial<UpdateOffer>): UpdateOffer =>
  ({ status: 'ready', version: '1.1.0', addedOptional: [], removed: [], updateToken: 't', ...over }) as UpdateOffer

const card = (update: UpdateOffer) =>
  render(<UpdateReviewCard update={update} declined={new Set()} onToggle={vi.fn()} />)

describe('UpdateReviewCard', () => {
  // The rename case reads in a locale that did NOT change; pin the UI language so it is one.
  let previousLanguage: string
  beforeAll(async () => {
    previousLanguage = i18n.language
    await i18n.changeLanguage('en-US')
  })
  afterAll(() => i18n.changeLanguage(previousLanguage))

  it('lists the permissions an update drops instead of calling it unchanged', () => {
    // Main computed `removed` all along; the wire never carried it, so a version that
    // only gives up a capability read "Permissions are unchanged".
    card(ready({ removed: ['clipboard.read'] }))

    expect(screen.queryByText(/unchanged|没有变化/)).toBeNull()
    expect(screen.getByText(/removed|移除/)).toBeInTheDocument()
  })

  it('shows the locale that actually changed when the current one reads the same', () => {
    // A rename in zh only, read in English, showed "Foo → Foo" and hid the identity change.
    card(ready({ identityChange: { name: { from: { en: 'Foo', zh: '甲' }, to: { en: 'Foo', zh: '乙' } } } }))

    const rename = screen.getByText(/甲/)
    expect(rename).toHaveTextContent(/乙/)
    expect(rename).toHaveTextContent(/zh/)
  })
})
