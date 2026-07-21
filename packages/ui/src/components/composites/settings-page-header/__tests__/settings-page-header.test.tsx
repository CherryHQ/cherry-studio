// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { SettingsPageHeader } from '../index'

afterEach(() => {
  cleanup()
})

describe('SettingsPageHeader', () => {
  it('renders title inside an h1', () => {
    render(<SettingsPageHeader title="Appearance" />)
    const heading = screen.getByRole('heading', { level: 1 })
    expect(heading).toHaveTextContent('Appearance')
  })

  it('renders optional icon, description and action slots', () => {
    render(
      <SettingsPageHeader
        icon={<svg data-testid="header-icon" />}
        title="Shortcuts"
        description="Configure keyboard shortcuts"
        action={<button type="button">Reset</button>}
      />
    )
    expect(screen.getByTestId('header-icon')).toBeInTheDocument()
    expect(screen.getByText('Configure keyboard shortcuts')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reset' })).toBeInTheDocument()
  })

  it('omits the description paragraph when not provided', () => {
    const { container } = render(<SettingsPageHeader title="System" />)
    expect(container.querySelector('p')).not.toBeInTheDocument()
  })

  it('forwards extra props like data-testid and merges className', () => {
    render(<SettingsPageHeader title="X" data-testid="settings-page-header" className="custom-extra" />)
    const node = screen.getByTestId('settings-page-header')
    expect(node).toHaveAttribute('data-slot', 'settings-page-header')
    expect(node.className).toMatch(/\bcustom-extra\b/)
  })
})
