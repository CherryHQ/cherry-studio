// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import { Checkbox } from '../checkbox'

afterEach(() => {
  cleanup()
})

describe('Checkbox', () => {
  it('reveals the square icon and hides the check icon while indeterminate', () => {
    const { container } = render(<Checkbox checked="indeterminate" />)

    const indicator = container.querySelector('[data-slot="checkbox-indicator"]')

    // Which icon shows is decided entirely by this group/group-data pairing, so the three
    // class strings have to keep agreeing or a partial selection silently reads as fully checked.
    expect(indicator).toHaveClass('group/indicator')
    expect(indicator?.querySelector('.lucide-check')).toHaveClass('group-data-[state=indeterminate]/indicator:hidden')
    expect(indicator?.querySelector('.lucide-square')).toHaveClass(
      'hidden',
      'group-data-[state=indeterminate]/indicator:block'
    )
  })

  // The icon above follows Radix's own state, so nothing in Checkbox may shadow it: mirroring
  // `checked` locally to pick the icon is the tempting fix, and it strands uncontrolled usage.
  it('advances an uncontrolled indeterminate checkbox to checked when clicked', async () => {
    const user = userEvent.setup()
    render(<Checkbox defaultChecked="indeterminate" />)

    const checkbox = screen.getByRole('checkbox')

    expect(checkbox).toHaveAttribute('aria-checked', 'mixed')
    await user.click(checkbox)
    expect(checkbox).toHaveAttribute('aria-checked', 'true')
  })
})
