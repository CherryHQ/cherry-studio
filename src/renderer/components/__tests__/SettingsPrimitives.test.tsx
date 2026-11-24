import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { SettingsContentColumn } from '../SettingsPrimitives'

describe('settings scroll boundary', () => {
  it('keeps page spacing inside the content so the scrollbar reaches the boundary', () => {
    render(<SettingsContentColumn data-testid="settings-content">Content</SettingsContentColumn>)

    const root = screen.getByTestId('settings-content')
    // Padding ownership is the scrollbar-edge regression contract.
    expect(root.querySelector('[data-slot=scroll-area-content]')).toHaveClass('p-6')
    expect(root).not.toHaveClass('p-6')
    expect(root.querySelector('[data-slot=scroll-area-viewport]')).not.toHaveClass('p-6')
  })
})
