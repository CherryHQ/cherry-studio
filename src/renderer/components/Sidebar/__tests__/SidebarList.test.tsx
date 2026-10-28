import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { SidebarList } from '../SidebarList'

vi.unmock('@cherrystudio/ui')

describe('unavailable sidebar shortcuts', () => {
  it.each(['icon', 'full'] as const)('stays focusable but cannot activate in %s layout', async (layout) => {
    const onOpen = vi.fn()
    const onOpenNewTab = vi.fn()
    const user = userEvent.setup()
    render(
      <SidebarList
        layout={layout}

        entries={[
          {
            key: 'unavailable',
            label: 'Unavailable resource',
            renderIcon: () => null,
            isActive: false,
            disabled: true,
            statusLabel: 'Resource temporarily unavailable',
            onOpen,
            onOpenNewTab
          }
        ]}
      />
    )
    const button = screen.getByRole('button', { name: 'Unavailable resource' })
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(button).toHaveAccessibleDescription('Resource temporarily unavailable')
    await user.click(button)
    expect(button).toHaveFocus()
    await user.keyboard('{Enter} ')
    fireEvent(button, new MouseEvent('auxclick', { bubbles: true, button: 1 }))
    expect(onOpen).not.toHaveBeenCalled()
    expect(onOpenNewTab).not.toHaveBeenCalled()
  })
})

describe('Sidebar entry interaction', () => {
  it.each(['icon', 'full'] as const)('supports keyboard activation and middle-click in %s layout', async (layout) => {
    const onOpen = vi.fn()
    const onOpenNewTab = vi.fn()
    const user = userEvent.setup()
    render(
      <SidebarList
        layout={layout}
        entries={[
          {
            key: 'resource',
            label: 'A resource with a long descriptive name',
            renderIcon: () => null,
            isActive: true,
            onOpen,
            onOpenNewTab
          }
        ]}
      />
    )

    const button = screen.getByRole('button', { name: 'A resource with a long descriptive name' })
    expect(button).toHaveAttribute('aria-current', 'page')
    await user.tab()
    expect(button).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(onOpen).toHaveBeenCalledOnce()
    fireEvent(button, new MouseEvent('auxclick', { bubbles: true, button: 1 }))
    expect(onOpenNewTab).toHaveBeenCalledOnce()
    expect(onOpen).toHaveBeenCalledOnce()
  })

  it('exposes the full name in an expanded-row tooltip', async () => {
    const user = userEvent.setup()
    const label = 'A long resource name that cannot fit in the narrow Sidebar'
    render(
      <SidebarList
        layout="full"
        entries={[
          {
            key: 'resource',
            label,
            renderIcon: () => null,
            isActive: false,
            onOpen: vi.fn()
          }
        ]}
      />
    )

    await user.hover(screen.getByRole('button', { name: label }))
    expect(await screen.findByRole('tooltip')).toHaveTextContent(label)
  })
})
