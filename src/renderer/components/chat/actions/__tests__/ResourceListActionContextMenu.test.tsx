import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { ResourceListActionContextMenu } from '../ResourceListActionContextMenu'

const openContextMenu = vi.fn()

// CommandContextMenu honours the native/cherry presentation mode internally; here we just render
// the trigger children so we can assert the right-click wiring regardless of mode.
vi.mock('@renderer/components/command', () => ({
  CommandContextMenu: ({ children }: { children: ReactNode }) => (
    <div data-testid="command-context-menu">{children}</div>
  )
}))

vi.mock('../../resources/ResourceListContext', () => ({
  useResourceListActions: () => ({ openContextMenu }),
  useResourceListItemAccessors: () => ({ getItemId: (item: { id: string }) => item.id })
}))

vi.mock('../actionMenuItems', () => ({
  actionsToCommandMenuExtraItems: () => []
}))

describe('ResourceListActionContextMenu', () => {
  it('marks the active item on right-click for both native and cherry presentation modes', () => {
    openContextMenu.mockClear()

    render(
      <ResourceListActionContextMenu actions={[]} item={{ id: 'topic-7', name: 'Topic 7' }} onAction={vi.fn()}>
        <button type="button">Row</button>
      </ResourceListActionContextMenu>
    )

    // The native menu path opens through onContextMenu (not onOpenChange), so the active item must
    // be set on the right-click itself — this fires for both presentation modes.
    fireEvent.contextMenu(screen.getByText('Row'))

    expect(openContextMenu).toHaveBeenCalledWith('topic-7')
  })
})
