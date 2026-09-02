// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import { InfoTooltip } from '../info-tooltip'

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as any
})

afterEach(() => {
  cleanup()
})

describe('InfoTooltip', () => {
  it('opens its explanation when the icon receives keyboard focus', async () => {
    const user = userEvent.setup()
    render(<InfoTooltip content="Localized explanation" ariaLabel="Setting information" />)

    const trigger = screen.getByRole('img', { name: 'Setting information' })

    await user.tab()

    expect(trigger).toHaveFocus()
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Localized explanation')
    expect(trigger.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })

  it('uses plain-text content as the localized accessible name by default', () => {
    render(<InfoTooltip content="Localized explanation" />)

    expect(screen.getByRole('img', { name: 'Localized explanation' })).toBeInTheDocument()
  })
})
