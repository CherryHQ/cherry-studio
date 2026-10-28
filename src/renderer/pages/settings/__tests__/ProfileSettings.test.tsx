import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ProfileSettings } from '../ProfileSettings'

vi.mock('@renderer/components/UserProfileEditor', () => ({
  UserProfileEditor: () => <button type="button" aria-label="Avatar editor" />
}))
vi.mock('../SubscriptionSettings', () => ({
  SubscriptionSettings: () => <div>Subscription and quota</div>
}))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

describe('ProfileSettings', () => {
  it('shows profile editing and subscription usage', () => {
    render(<ProfileSettings />)

    expect(screen.getByRole('heading', { name: 'settings.profile.title' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Avatar editor' })).toBeInTheDocument()
    expect(screen.getByText('Subscription and quota')).toBeInTheDocument()
  })
})
