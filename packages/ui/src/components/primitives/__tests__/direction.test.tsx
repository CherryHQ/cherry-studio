// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { DirectionProvider, resolveInlineSide, useDirection } from '../direction'

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

describe('resolveInlineSide', () => {
  it('maps logical sides onto physical ones per direction', () => {
    expect(resolveInlineSide('start', 'ltr')).toBe('left')
    expect(resolveInlineSide('end', 'ltr')).toBe('right')
    expect(resolveInlineSide('start', 'rtl')).toBe('right')
    expect(resolveInlineSide('end', 'rtl')).toBe('left')
  })
})
