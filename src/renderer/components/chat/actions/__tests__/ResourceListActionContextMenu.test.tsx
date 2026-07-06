import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { ResourceListActionContextMenu } from '../ResourceListActionContextMenu'

const openContextMenu = vi.fn()

// The native/cherry presentation-mode branching lives in CommandMenus and is its own concern; the
// point of this test is the *mode-independent* wrapper onContextMenu that identifies the clicked row.
// The mock just renders the children inside a span and we assert the right-click bubbles through it.
vi.mock('@renderer/components/command', () => ({
  CommandContextMenu: ({ children }: { children: ReactNode }) => (
    <span data-testid="command-context-menu">{children}</span>
  )
}))

vi.mock('../../resourceList/base', () => ({
  useResourceListActions: () => ({ openContextMenu }),
  useResourceListItemAccessors: () => ({ getItemId: (item: { id: string }) => item.id })
}))

vi.mock('../actionMenuItems', () => ({
  actionsToCommandMenuExtraItems: () => []
}))

describe('ResourceListActionContextMenu', () => {
  it('sets the active item on the right-click itself, independent of the presentation mode', () => {
    openContextMenu.mockClear()

    render(
      <ResourceListActionContextMenu actions={[]} item={{ id: 'topic-7', name: 'Topic 7' }} onAction={vi.fn()}>
        <button type="button">Row</button>
      </ResourceListActionContextMenu>
    )

    // The wrapper onContextMenu fires on the right-click for both modes and carries the row identity.
    fireEvent.contextMenu(screen.getByText('Row'))

    expect(openContextMenu).toHaveBeenCalledWith('topic-7')
  })
})
