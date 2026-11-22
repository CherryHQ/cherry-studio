import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  iconNames: ['heart', 'heart-pulse', 'alarm-clock', 'house', 'languages']
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
  // and sized rows (getBoundingClientRect via measureElement). Client dimensions
  // cover virtual-core versions that measure the scrollport without borders.
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
  for (const [name, dimension] of [
    ['clientWidth', 320],
    ['clientHeight', 256]
  ] as const) {
    Object.defineProperty(HTMLElement.prototype, name, {
      configurable: true,
      get(this: HTMLElement) {
        return this.className.includes('overflow-y-auto') ? dimension : 0
      }
    })
  }
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
    }
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
    await waitFor(() =>
      expect(document.querySelector('.overflow-y-auto')).toHaveStyle({
        maxHeight: 'calc(var(--radix-popover-content-available-height) - 104px)'
      })
    )

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
    const search = await screen.findByRole('textbox', { name: 'common.search' })
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

    await waitFor(() => expect(onChange).toHaveBeenCalledWith('alarm-clock'))
  })

  it('does not offer unsupported icon values saved before the picker', async () => {
    const user = userEvent.setup()
    render(<SelectionActionIconPicker value="missing-icon" onChange={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'missing-icon' }))
    await user.type(await screen.findByRole('textbox', { name: 'common.search' }), 'missing-icon')

    expect(await screen.findByText('common.no_results')).toBeInTheDocument()
  })
  it.each([
    ['translate', 'languages'],
    ['翻译', 'languages'],
    ['互译', 'languages'],
    ['heartbeat', 'heart-pulse'],
    ['心跳', 'heart-pulse'],
    ['血压', 'heart-pulse'],
    [' HEART-PULSE ', 'heart-pulse']
  ])('finds %s by purpose or name', async (query, icon) => {
    const user = userEvent.setup()
    render(<SelectionActionIconPicker value="" onChange={vi.fn()} />)
    await user.click(screen.getByText('selection.settings.user_modal.icon.placeholder'))
    await user.type(await screen.findByRole('textbox', { name: 'common.search' }), query)
    expect(await screen.findByRole('button', { name: icon })).toBeInTheDocument()
  })

  it('clears the chosen icon and closes the picker', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<SelectionActionIconPicker value="heart" onChange={onChange} />)
    await user.click(screen.getByText('heart'))
    await user.click(await screen.findByRole('button', { name: 'selection.settings.user_modal.icon.default' }))
    expect(onChange).toHaveBeenCalledWith('')
    await waitFor(() => expect(screen.queryByRole('textbox')).not.toBeInTheDocument())
  })

  it('has a visible focus treatment and supports keyboard selection', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<SelectionActionIconPicker value="" onChange={onChange} />)
    await user.click(screen.getByText('selection.settings.user_modal.icon.placeholder'))
    const search = await screen.findByRole('textbox', { name: 'common.search' })
    await user.click(search)
    await user.tab()
    const icon = screen.getByRole('button', { name: 'heart' })
    expect(icon).toHaveFocus()
    expect(icon).toHaveClass('focus-visible:ring-2', 'focus-visible:ring-ring', 'focus-visible:ring-inset')
    await user.keyboard('{Enter}')
    expect(onChange).toHaveBeenCalledWith('heart')
  })

  it('shows keyboard focus with a ring that the global outline reset cannot remove', async () => {
    render(<SelectionActionIconPicker value="" onChange={vi.fn()} />)
    fireEvent.click(screen.getByText('selection.settings.user_modal.icon.placeholder'))
    const button = await waitFor(() => {
      const found = document.querySelector('button[aria-pressed]')
      expect(found).not.toBeNull()
      return found as HTMLButtonElement
    })
    expect(button.className).toContain('focus-visible:ring-2')
    expect(button.className).toContain('focus-visible:ring-inset')
    expect(button.className).not.toContain('focus-visible:outline')
  })

  it('returns the grid to its first row when the query changes', async () => {
    render(<SelectionActionIconPicker value="" onChange={vi.fn()} />)
    fireEvent.click(screen.getByText('selection.settings.user_modal.icon.placeholder'))
    await waitFor(() => expect(document.querySelectorAll('button[aria-pressed]').length).toBeGreaterThan(0))
    const scroller = document.querySelector('.overflow-y-auto') as HTMLElement
    scroller.scrollTop = 400
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'heart' } })
    expect(scroller.scrollTop).toBe(0)
  })
})
