// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import i18n from '@renderer/i18n/resolver'
import { MockSecretInput } from '@test-mocks/renderer/CherrystudioUI'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { SecretInput } from '../SecretInput'

vi.unmock('@cherrystudio/ui')

let previousLanguage: string

beforeAll(async () => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver

  previousLanguage = i18n.language
  await i18n.changeLanguage('en-US')
})

afterAll(async () => {
  await i18n.changeLanguage(previousLanguage)
})

describe('SecretInput', () => {
  it('keeps the renderer stand-in aligned with the shared input boundary', () => {
    const props = {
      'aria-label': 'Credential',
      disabled: true,
      hideLabel: 'Hide credential',
      inputClassName: 'contract-input',
      name: 'credential',
      placeholder: 'Enter credential',
      showLabel: 'Show credential',
      value: 'secret-value'
    }
    const readInputContract = (input: HTMLInputElement) => ({
      ariaLabel: input.getAttribute('aria-label'),
      disabled: input.disabled,
      hasInputClassName: input.classList.contains('contract-input'),
      name: input.name,
      placeholder: input.placeholder,
      spellCheck: input.spellcheck,
      type: input.type,
      value: input.value
    })

    const real = render(<SecretInput {...props} />)
    const realContract = readInputContract(screen.getByLabelText('Credential'))
    real.unmount()

    render(<MockSecretInput {...props} />)

    expect(readInputContract(screen.getByLabelText('Credential'))).toEqual(realContract)
  })

  it('exposes localized show and hide accessible names by default', async () => {
    const user = userEvent.setup()
    render(<SecretInput aria-label="Credential" />)

    const showButton = screen.getByRole('button', { name: i18n.t('common.show_credential') })
    expect(showButton).toBeInTheDocument()

    await user.click(showButton)
    expect(screen.getByRole('button', { name: i18n.t('common.hide_credential') })).toBeInTheDocument()
  })

  it('uses caller-provided show and hide names instead of the localized defaults', async () => {
    const user = userEvent.setup()
    render(<SecretInput aria-label="Credential" showLabel="Reveal API key" hideLabel="Conceal API key" />)

    expect(screen.queryByRole('button', { name: i18n.t('common.show_credential') })).not.toBeInTheDocument()
    const showButton = screen.getByRole('button', { name: 'Reveal API key' })

    await user.click(showButton)
    expect(screen.queryByRole('button', { name: i18n.t('common.hide_credential') })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Conceal API key' })).toBeInTheDocument()
  })
})
