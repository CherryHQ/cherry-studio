// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Command, CommandInput } from '../command'

describe('CommandInput', () => {
  it('allows the input wrapper surface to be styled independently', () => {
    render(
      <Command>
        <CommandInput aria-label="Search" wrapperClassName="rounded-lg border-border-strong" />
      </Command>
    )

    expect(screen.getByRole('combobox').parentElement).toHaveClass('rounded-lg', 'border-border-strong')
  })
})
