import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  iconNames: ['heart', 'heart-pulse', 'alarm-clock', 'house']
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

// Coverage must exercise the real popover portal and portal-container hook,
// not the renderer-wide lightweight primitives mock.
vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal())

// Stub bundle: 4 icons, so the first-open grid below is exactly 1 virtualized row.
// These tests prove the mount/measure race fix and the behavior contracts against
// the real popover, portal and virtualizer - not rendering of the full ~1500-icon
// production bundle.
vi.mock('lucide-react/dynamic', () => ({
  DynamicIcon: ({ name }: { name: string }) => <svg data-testid={`icon-${name}`} />,
  iconNames: mocks.iconNames
}))

import SelectionActionIconPicker from '../SelectionActionIconPicker'

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  // jsdom reports zero boxes; the virtualizer needs a sized scrollport (offset*)
  // and sized rows (getBoundingClientRect via measureElement).
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return this.className.includes('overflow-y-auto') ? 320 : 0
    }
  })
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return this.className.includes('overflow-y-auto') ? 256 : 0
    }
  })
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const height = 40
    return {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      bottom: height,
      right: 320,
      width: 320,
      height,
      toJSON: () => ({})
    } as DOMRect
  }
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('SelectionActionIconPicker', () => {
  it('renders browsable icons on first open without a search query', async () => {
    render(<SelectionActionIconPicker value="" onChange={vi.fn()} />)

    fireEvent.click(screen.getByText('selection.settings.user_modal.icon.placeholder'))

    // The real virtualizer must produce rows from the mounted scroll element alone;
    // first-open browsing broke when the scroll ref never retriggered measurement.
    await waitFor(() => {
      const gridButtons = document.querySelectorAll('button[aria-pressed]')
      expect(gridButtons.length).toBeGreaterThan(0)
    })
  })

  it('selects an icon from the first-open grid', async () => {
    const onChange = vi.fn()
    render(<SelectionActionIconPicker value="" onChange={onChange} />)

    fireEvent.click(screen.getByText('selection.settings.user_modal.icon.placeholder'))
    const first = await waitFor(() => {
      const gridButtons = document.querySelectorAll('button[aria-pressed]')
      expect(gridButtons.length).toBeGreaterThan(0)
      return gridButtons[0] as HTMLButtonElement
    })
    fireEvent.click(first)

    expect(onChange).toHaveBeenCalledWith(expect.any(String))
  })

  it('filters available icons by name and closes after selecting one', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<SelectionActionIconPicker value="heart" onChange={onChange} />)

    await user.click(screen.getByText('heart'))
    const search = screen.getByRole('textbox', { name: 'common.search' })
    await user.type(search, 'pulse')

    expect(await screen.findByRole('button', { name: 'heart-pulse' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'heart' })).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'heart-pulse' }))

    expect(onChange).toHaveBeenCalledWith('heart-pulse')
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'common.search' })).not.toBeInTheDocument())
  })

  it('keeps the random icon shortcut limited to available icons', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    render(<SelectionActionIconPicker value="" onChange={onChange} />)

    await user.click(screen.getByRole('button', { name: 'selection.settings.user_modal.icon.random' }))

    expect(onChange).toHaveBeenCalledWith('alarm-clock')
  })

  it('does not offer unsupported icon values saved before the picker', async () => {
    const user = userEvent.setup()
    render(<SelectionActionIconPicker value="missing-icon" onChange={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'missing-icon' }))
    await user.type(screen.getByRole('textbox', { name: 'common.search' }), 'missing-icon')

    expect(await screen.findByText('common.no_results')).toBeInTheDocument()
  })
})
