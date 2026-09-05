// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { SecretInput } from '../index'

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as any
})

describe('SecretInput', () => {
  it('toggles a credential between masked and visible text', async () => {
    const user = userEvent.setup()
    const onBlur = vi.fn()
    render(
      <SecretInput
        aria-label="Credential"
        value="secret-value"
        readOnly
        onBlur={onBlur}
        showLabel="Show credential"
        hideLabel="Hide credential"
      />
    )

    const input = screen.getByLabelText('Credential')
    const showButton = screen.getByRole('button', { name: 'Show credential' })
    expect(input).toHaveAttribute('type', 'password')
    expect(showButton).toHaveAttribute('aria-pressed', 'false')

    input.focus()
    expect(input).toHaveFocus()

    await user.click(showButton)
    expect(input).toHaveAttribute('type', 'text')
    const hideButton = screen.getByRole('button', { name: 'Hide credential' })
    expect(hideButton).toHaveAttribute('aria-pressed', 'true')
    expect(input).toHaveFocus()
    expect(onBlur).not.toHaveBeenCalled()

    await user.click(hideButton)
    expect(input).toHaveAttribute('type', 'password')
    expect(screen.getByRole('button', { name: 'Show credential' })).toHaveAttribute('aria-pressed', 'false')
    expect(input).toHaveFocus()
    expect(onBlur).not.toHaveBeenCalled()
  })

  it('disables both the input and visibility toggle', () => {
    render(
      <SecretInput
        aria-label="Credential"
        value="secret-value"
        readOnly
        disabled
        showLabel="Show credential"
        hideLabel="Hide credential"
      />
    )

    expect(screen.getByLabelText('Credential')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Show credential' })).toBeDisabled()
  })

  it('forwards its ref to the input element', () => {
    let inputElement: HTMLInputElement | null = null
    render(
      <SecretInput
        ref={(element) => {
          inputElement = element
        }}
        aria-label="Credential"
        showLabel="Show credential"
        hideLabel="Hide credential"
      />
    )

    expect(inputElement).toBe(screen.getByLabelText('Credential'))
  })

  it('remasks when the same instance is bound to a different credential', async () => {
    const user = userEvent.setup()
    const { rerender } = render(
      <SecretInput
        aria-label="Credential"
        value="first-secret"
        readOnly
        showLabel="Show credential"
        hideLabel="Hide credential"
      />
    )

    await user.click(screen.getByRole('button', { name: 'Show credential' }))
    expect(screen.getByLabelText('Credential')).toHaveAttribute('type', 'text')

    rerender(
      <SecretInput
        aria-label="Credential"
        value="second-secret"
        readOnly
        showLabel="Show credential"
        hideLabel="Hide credential"
      />
    )

    expect(screen.getByLabelText('Credential')).toHaveAttribute('type', 'password')
    expect(screen.getByRole('button', { name: 'Show credential' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('keeps a revealed credential visible while the user edits it', async () => {
    function Harness() {
      const [value, setValue] = useState('secret-value')
      return (
        <SecretInput
          aria-label="Credential"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          showLabel="Show credential"
          hideLabel="Hide credential"
        />
      )
    }

    const user = userEvent.setup()
    render(<Harness />)

    await user.click(screen.getByRole('button', { name: 'Show credential' }))
    const input = screen.getByLabelText('Credential')
    await user.type(input, 'x')

    expect(input).toHaveValue('secret-valuex')
    expect(input).toHaveAttribute('type', 'text')
    expect(screen.getByRole('button', { name: 'Hide credential' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('keeps a controlled numeric credential visible while the user edits it', async () => {
    function Harness() {
      const [value, setValue] = useState(123)
      return (
        <SecretInput
          aria-label="Credential"
          value={value}
          onChange={(event) => setValue(Number(event.target.value))}
          showLabel="Show credential"
          hideLabel="Hide credential"
        />
      )
    }

    const user = userEvent.setup()
    render(<Harness />)

    await user.click(screen.getByRole('button', { name: 'Show credential' }))
    const input = screen.getByLabelText('Credential')
    await user.type(input, '4')

    expect(input).toHaveValue('1234')
    expect(input).toHaveAttribute('type', 'text')
    expect(screen.getByRole('button', { name: 'Hide credential' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('does not spellcheck a revealed credential unless the caller opts in', async () => {
    const user = userEvent.setup()
    const { rerender } = render(
      <SecretInput aria-label="Credential" showLabel="Show credential" hideLabel="Hide credential" />
    )

    expect(screen.getByLabelText('Credential')).toHaveAttribute('spellcheck', 'false')

    await user.click(screen.getByRole('button', { name: 'Show credential' }))
    expect(screen.getByLabelText('Credential')).toHaveAttribute('spellcheck', 'false')

    rerender(<SecretInput aria-label="Credential" spellCheck showLabel="Show credential" hideLabel="Hide credential" />)
    expect(screen.getByLabelText('Credential')).toHaveAttribute('spellcheck', 'true')
  })
})
