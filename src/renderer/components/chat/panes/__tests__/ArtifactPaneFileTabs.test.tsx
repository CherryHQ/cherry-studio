import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ArtifactPaneFileTabs, fitFileTabs } from '../ArtifactPaneFileTabs'

vi.unmock('@cherrystudio/ui')

const tabs = ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts'].map((name) => ({ key: name, title: name, path: `/ws/${name}` }))
const keys = (list: { key: string }[]) => list.map((tab) => tab.key)

describe('fitFileTabs', () => {
  it('shows every tab while they fit at their readable minimum', () => {
    const { visible, hidden } = fitFileTabs(tabs, 'a.ts', 5 * 116)
    expect(keys(visible)).toEqual(['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts'])
    expect(hidden).toEqual([])
  })

  it('moves the tabs that do not fit into the overflow list', () => {
    const { visible, hidden } = fitFileTabs(tabs, 'a.ts', 3 * 116 + 32)
    expect(keys(visible)).toEqual(['a.ts', 'b.ts', 'c.ts'])
    expect(keys(hidden)).toEqual(['d.ts', 'e.ts'])
  })

  it('keeps an active tab that would overflow in the last visible slot', () => {
    const { visible, hidden } = fitFileTabs(tabs, 'e.ts', 3 * 116 + 32)
    expect(keys(visible)).toEqual(['a.ts', 'b.ts', 'e.ts'])
    expect(keys(hidden)).toEqual(['c.ts', 'd.ts'])
  })
})

describe('ArtifactPaneFileTabs', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('lists only the hidden tabs in the overflow menu and activates the chosen one', async () => {
    const width = 3 * 116 + 32
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(private readonly callback: ResizeObserverCallback) {}
        observe(target: Element) {
          this.callback([{ target, contentRect: { width } } as unknown as ResizeObserverEntry], this)
        }
        unobserve() {}
        disconnect() {}
      }
    )
    const onActivate = vi.fn()
    render(
      <ArtifactPaneFileTabs
        tabs={tabs}
        activeKey="a.ts"
        activeDirty={false}
        dirtyLabel="Unsaved"
        closeLabel="Close"
        overflowLabel="Show all tabs"
        onActivate={onActivate}
        onClose={vi.fn()}
      />
    )

    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['a.ts', 'b.ts', 'c.ts'])
    await userEvent.click(screen.getByRole('button', { name: 'Show all tabs' }))
    const items = await screen.findAllByRole('menuitem')
    expect(items.map((item) => item.textContent)).toEqual(['d.ts', 'e.ts'])

    await userEvent.click(items[1])
    expect(onActivate).toHaveBeenCalledWith('e.ts')
  })
})
