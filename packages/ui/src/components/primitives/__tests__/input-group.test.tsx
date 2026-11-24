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

  it('leaves focus on an addon button when its child is clicked', async () => {
    const user = userEvent.setup()
    render(
      <InputGroup>
        <InputGroupAddon>
          <button type="button">
            <span>Action</span>
          </button>
        </InputGroupAddon>
        <InputGroupInput aria-label="Value" />
      </InputGroup>
    )

    await user.click(screen.getByText('Action'))

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
