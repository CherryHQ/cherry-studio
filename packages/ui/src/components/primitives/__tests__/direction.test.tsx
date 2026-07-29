// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { type Direction, DirectionProvider, resolveInlineSide, useDirection } from '../direction'

afterEach(() => {
  cleanup()
})

function DirectionProbe() {
  const direction = useDirection()
  return <span data-testid="probe">{direction}</span>
}

describe('useDirection', () => {
  it('defaults to ltr when no provider is mounted', () => {
    render(<DirectionProbe />)

    expect(screen.getByTestId('probe')).toHaveTextContent('ltr')
  })

  it('reports the mounted direction', () => {
    render(
      <DirectionProvider dir="rtl">
        <DirectionProbe />
      </DirectionProvider>
    )

    expect(screen.getByTestId('probe')).toHaveTextContent('rtl')
  })
})

describe('DirectionProvider', () => {
  // Logical CSS resolves against the rendered dir attribute while components resolve against
  // context; publishing only one of the two lets a surface anchor to the opposite edge.
  it.each<Direction>(['ltr', 'rtl'])('exposes %s to logical CSS as a dir attribute', (dir) => {
    render(
      <DirectionProvider dir={dir}>
        <span data-testid="child">child</span>
      </DirectionProvider>
    )

    expect(screen.getByTestId('child').closest('[dir]')).toHaveAttribute('dir', dir)
  })

  it('keeps the attribute carrier out of layout', () => {
    render(
      <DirectionProvider dir="rtl">
        <span data-testid="child">child</span>
      </DirectionProvider>
    )

    expect(screen.getByTestId('child').closest('[dir]')).toHaveStyle({ display: 'contents' })
  })
})

describe('resolveInlineSide', () => {
  it('maps logical sides onto physical ones per direction', () => {
    expect(resolveInlineSide('start', 'ltr')).toBe('left')
    expect(resolveInlineSide('end', 'ltr')).toBe('right')
    expect(resolveInlineSide('start', 'rtl')).toBe('right')
    expect(resolveInlineSide('end', 'rtl')).toBe('left')
  })
})
