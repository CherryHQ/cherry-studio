// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { MenuItem } from '../index'

afterEach(() => {
  cleanup()
})

describe('MenuItem', () => {
  it('applies labelClassName to the label wrapper so callers can style the label without CSS inheritance hacks', () => {
    render(
      <MenuItem
        label="Model Service"
        active
        className="font-normal"
        labelClassName="group-data-[active=true]:font-medium"
        data-testid="menu-item"
      />
    )

    const item = screen.getByTestId('menu-item')
    const label = screen.getByText('Model Service')

    expect(item).toHaveAttribute('data-active', 'true')
    expect(item.className).toContain('group')
    expect(label).toHaveClass('group-data-[active=true]:font-medium')
  })
})
