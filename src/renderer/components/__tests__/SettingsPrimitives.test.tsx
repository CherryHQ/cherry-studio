import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import {
  SettingDescription,
  SettingGroup,
  SettingHelpText,
  SettingsContentBody,
  SettingsContentColumn
} from '../SettingsPrimitives'

describe('settings page containers', () => {
  it.each([
    ['scrolling column', SettingsContentColumn],
    ['scroll body', SettingsContentBody]
  ])('keeps 24px padding around the %s', (_, Component) => {
    render(<Component data-testid="settings-content">Content</Component>)

    expect(screen.getByTestId('settings-content')).toHaveClass('p-6')
    expect(screen.getByTestId('settings-content')).not.toHaveClass('pt-3', 'py-4')
  })
})

describe('SettingGroup', () => {
  it('renders settings sections as bordered cards by default', () => {
    render(<SettingGroup data-testid="setting-group">Content</SettingGroup>)

    expect(screen.getByTestId('setting-group')).toHaveClass('rounded-xl', 'border', 'border-border', 'bg-card', 'p-4')
    expect(screen.getByTestId('setting-group')).toHaveStyle({
      backgroundColor: 'var(--settings-group-background, var(--card))'
    })
  })

  it('keeps the legacy divider layout for plain groups', () => {
    render(
      <SettingGroup data-testid="setting-group" variant="plain">
        Content
      </SettingGroup>
    )

    expect(screen.getByTestId('setting-group')).toHaveClass('border-t', 'pt-3')
    expect(screen.getByTestId('setting-group')).not.toHaveClass('rounded-xl', 'bg-card', 'p-4')
    expect(screen.getByTestId('setting-group').style.backgroundColor).toBe('')
  })
})

describe('settings copy', () => {
  it.each([
    ['description', SettingDescription],
    ['help text', SettingHelpText]
  ])('uses the readable secondary foreground for %s', (_, Component) => {
    render(<Component data-testid="settings-copy">Content</Component>)

    expect(screen.getByTestId('settings-copy')).toHaveClass('text-muted-foreground')
    expect(screen.getByTestId('settings-copy')).not.toHaveClass('text-foreground-tertiary')
  })
})
