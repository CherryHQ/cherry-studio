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
        active={{ activeItem: '' }}
        entries={[
          {
            key: 'unavailable',
            label: 'Unavailable resource',
            renderIcon: () => null,
            isActive: () => false,
            disabled: true,
            onOpen,
            onOpenNewTab
          }
        ]}
      />
    )
    const button = screen.getByRole('button', { name: 'Unavailable resource' })
    expect(button).toHaveAttribute('aria-disabled', 'true')
    await user.click(button)
    expect(button).toHaveFocus()
    await user.keyboard('{Enter} ')
    fireEvent(button, new MouseEvent('auxclick', { bubbles: true, button: 1 }))
    expect(onOpen).not.toHaveBeenCalled()
    expect(onOpenNewTab).not.toHaveBeenCalled()
  })
})
