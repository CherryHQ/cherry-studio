// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { WindowControlsContainer } from '../WindowControls.styled'

describe('WindowControlsContainer', () => {
  it('stays in the shell stacking order so modal scrims cover it', () => {
    render(<WindowControlsContainer data-testid="window-controls" />)

    const controls = screen.getByTestId('window-controls')
    const hasExplicitZIndex = Array.from(controls.classList).some((className) => className.startsWith('z-'))

    expect(hasExplicitZIndex).toBe(false)
    expect(controls).toHaveClass(
      'flex',
      'h-full',
      'min-h-0',
      'select-none',
      'items-stretch',
      '[-webkit-app-region:no-drag]'
    )
  })
})
