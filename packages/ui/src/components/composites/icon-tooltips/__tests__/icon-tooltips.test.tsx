// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

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
    const tooltip = await screen.findByRole('tooltip')
    expect(tooltip).toHaveTextContent('Localized explanation')
    expect(trigger).toHaveAttribute('aria-describedby', tooltip.id)
    expect(trigger.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })

  it('uses a button and activates the click contract with Enter and Space', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(<InfoTooltip content="Open documentation" ariaLabel="Documentation help" onClick={onClick} />)

    const trigger = screen.getByRole('button', { name: 'Documentation help' })
    await user.tab()
    await user.keyboard('{Enter}')
    await user.keyboard(' ')

    expect(trigger).toHaveFocus()
    expect(onClick).toHaveBeenCalledTimes(2)
  })

  it('uses plain-text content as the localized accessible name by default', () => {
    render(<InfoTooltip content="Localized explanation" />)

    expect(screen.getByRole('img', { name: 'Localized explanation' })).toBeInTheDocument()
  })
})
