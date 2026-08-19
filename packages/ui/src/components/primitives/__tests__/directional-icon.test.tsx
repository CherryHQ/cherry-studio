// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { DirectionProvider } from '../direction'
import { DirectionalIcon } from '../directional-icon'

describe('DirectionalIcon', () => {
  it.each(['ltr', 'rtl'] as const)('exposes the active %s direction to the shared mirror style', (direction) => {
    render(
      <DirectionProvider dir={direction}>
        <DirectionalIcon data-testid="icon">→</DirectionalIcon>
      </DirectionProvider>
    )

    expect(screen.getByTestId('icon')).toHaveAttribute('data-direction', direction)
  })
})
