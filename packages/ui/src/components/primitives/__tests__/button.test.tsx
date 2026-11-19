// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Button } from '../button'

describe('Button', () => {
  it('announces loading and disables the button', () => {
    render(<Button loading>Save</Button>)

    const button = screen.getByRole('button', { name: /save/i })
    expect(button).toHaveAttribute('aria-busy', 'true')
    expect(button).toBeDisabled()
  })
})
