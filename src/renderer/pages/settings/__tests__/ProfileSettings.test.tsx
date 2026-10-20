import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ProfileSettings } from '../ProfileSettings'

const { edition } = vi.hoisted(() => ({ edition: { current: 'global' } }))

vi.mock('@renderer/components/UserProfileEditor', () => ({
  UserProfileEditor: () => <button type="button" aria-label="Avatar editor" />
}))
vi.mock('../SubscriptionSettings', () => ({
  SubscriptionSettings: () => <div>Subscription and quota</div>
}))
vi.mock('@renderer/utils/appEdition', () => ({ getAppEdition: () => edition.current }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

afterEach(() => {
  edition.current = 'global'
})

describe('ProfileSettings', () => {
  it('shows profile editing and subscription usage in the global edition', () => {
    render(<ProfileSettings />)

    expect(screen.getByRole('heading', { name: 'settings.profile.title' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Avatar editor' })).toBeInTheDocument()
    expect(screen.getByText('Subscription and quota')).toBeInTheDocument()
  })

  it('preserves profile editing without cloud subscription in the CN edition', () => {
    edition.current = 'cn'
    render(<ProfileSettings />)

    expect(screen.getByRole('button', { name: 'Avatar editor' })).toBeInTheDocument()
    expect(screen.queryByText('Subscription and quota')).not.toBeInTheDocument()
  })
})
