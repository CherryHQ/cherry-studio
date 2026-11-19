import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { RightPaneTabs, fitPaneTabs } from '../RightPaneTabs'

vi.unmock('@cherrystudio/ui')

const tabs = ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts'].map((name) => ({ key: name, title: name, path: `/ws/${name}` }))
const keys = (list: { key: string }[]) => list.map((tab) => tab.key)

describe('fitPaneTabs', () => {
  it('shows every tab while they fit at their readable minimum', () => {
    const { visible, hidden } = fitPaneTabs(tabs, 'a.ts', 5 * 116)
    expect(keys(visible)).toEqual(['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts'])
    expect(hidden).toEqual([])
  })

  it('moves the tabs that do not fit into the overflow list', () => {
    const { visible, hidden } = fitPaneTabs(tabs, 'a.ts', 3 * 116 + 32)
    expect(keys(visible)).toEqual(['a.ts', 'b.ts', 'c.ts'])
    expect(keys(hidden)).toEqual(['d.ts', 'e.ts'])
  })

  it('keeps an active tab that would overflow in the last visible slot', () => {
    const { visible, hidden } = fitPaneTabs(tabs, 'e.ts', 3 * 116 + 32)
    expect(keys(visible)).toEqual(['a.ts', 'b.ts', 'e.ts'])
    expect(keys(hidden)).toEqual(['c.ts', 'd.ts'])
  })
})

describe('RightPaneTabs', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('lists only the hidden tabs in the overflow menu and activates the chosen one', async () => {
    let width = 3 * 116 + 32
    let resize = () => {}
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(private readonly callback: ResizeObserverCallback) {}
        observe(target: Element) {
          if (target.getAttribute('data-slot') !== 'tabs') return
          resize = () => this.callback([{ target, contentRect: { width } } as ResizeObserverEntry], this)
          resize()
        }
        unobserve() {}
        disconnect() {}
      }
    )
    function Harness() {
      const [active, setActive] = useState('a.ts')
      return (
        <RightPaneTabs
          tabs={tabs}
          activeKey={active}
          closeLabel="Close"
          overflowLabel="Show all tabs"
          onActivate={setActive}
          onClose={() => {}}
        />
      )
    }
    render(<Harness />)

    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['a.ts', 'b.ts', 'c.ts'])
    await userEvent.click(screen.getByRole('button', { name: 'Show all tabs' }))
    const items = await screen.findAllByRole('menuitem')
    expect(items.map((item) => item.textContent)).toEqual(['d.ts', 'e.ts'])

    await userEvent.click(items[1])
    expect(screen.getByRole('tab', { name: 'e.ts' })).toHaveAttribute('aria-selected', 'true')
    width = 900
    act(() => resize())
    expect(screen.getAllByRole('tab')).toHaveLength(5)
    expect(screen.queryByRole('button', { name: 'Show all tabs' })).not.toBeInTheDocument()
  })
})
