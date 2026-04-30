// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { Switch } from '../switch'

afterEach(() => {
  cleanup()
})

describe('Switch', () => {
  it('keeps the established sm size', () => {
    render(<Switch size="sm" />)

    const root = screen.getByRole('switch')
    const thumb = root.querySelector('[data-slot="switch-thumb"]')

    expect(root).toHaveClass('w-9', 'h-5')
    expect(thumb).toHaveClass('size-4.5', 'data-[state=checked]:translate-x-4')
  })

  it('supports a compact xs size for dense layouts', () => {
    render(<Switch size="xs" />)

    const root = screen.getByRole('switch')
    const thumb = root.querySelector('[data-slot="switch-thumb"]')

    expect(root).toHaveClass('h-4.5', 'w-8')
    expect(thumb).toHaveClass('size-4', 'data-[state=checked]:translate-x-3.5')
  })
})
