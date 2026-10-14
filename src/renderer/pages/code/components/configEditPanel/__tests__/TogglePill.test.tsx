import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { TogglePill } from '../TogglePill'

describe('TogglePill', () => {
  it('exposes pressed state and calls onClick', () => {
    const onClick = vi.fn()

    render(<TogglePill label="Enable tool search" active onClick={onClick} />)

    const toggle = screen.getByRole('button', { name: 'Enable tool search' })

    expect(toggle).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(toggle)

    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
