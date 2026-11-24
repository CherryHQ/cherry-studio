// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createPortal } from 'react-dom'
import { afterEach, describe, expect, it } from 'vitest'

import { InputGroup, InputGroupAddon, InputGroupInput } from '../input-group'

afterEach(cleanup)

describe('InputGroupAddon focus', () => {
  it('focuses the associated field when its inline text is clicked', async () => {
    const user = userEvent.setup()
    render(
      <InputGroup>
        <InputGroupAddon>Prefix</InputGroupAddon>
        <InputGroupInput aria-label="Value" />
      </InputGroup>
    )

    await user.click(screen.getByText('Prefix'))

    expect(screen.getByRole('textbox', { name: 'Value' })).toHaveFocus()
  })

  it.each(['text', 'SVG'] as const)('leaves focus on an addon button when its %s child is clicked', async (child) => {
    const user = userEvent.setup()
    render(
      <InputGroup>
        <InputGroupAddon>
          <button type="button" aria-label="Action">
            {child === 'text' ? <span>Action</span> : <svg role="img" aria-label="Action icon" />}
          </button>
        </InputGroupAddon>
        <InputGroupInput aria-label="Value" />
      </InputGroup>
    )

    await user.click(child === 'text' ? screen.getByText('Action') : screen.getByRole('img', { name: 'Action icon' }))

    expect(screen.getByRole('button', { name: 'Action' })).toHaveFocus()
  })

  it('does not steal focus from a portaled field owned by an addon child', async () => {
    const user = userEvent.setup()
    render(
      <InputGroup>
        <InputGroupAddon>{createPortal(<input aria-label="Popup field" />, document.body)}</InputGroupAddon>
        <InputGroupInput aria-label="Value" />
      </InputGroup>
    )

    await user.click(screen.getByRole('textbox', { name: 'Popup field' }))

    expect(screen.getByRole('textbox', { name: 'Popup field' })).toHaveFocus()
  })
})
