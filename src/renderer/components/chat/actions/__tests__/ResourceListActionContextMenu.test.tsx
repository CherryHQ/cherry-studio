import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { ResourceListActionContextMenu } from '../ResourceListActionContextMenu'

const openContextMenu = vi.fn()
const commandMenuMocks = vi.hoisted(() => ({
  props: [] as Array<{ getExtraItems?: () => unknown; extraItems?: unknown }>
}))
const actionMenuItemMocks = vi.hoisted(() => ({
  actionsToCommandMenuExtraItems: vi.fn(() => [])
}))

// The native/cherry presentation-mode branching lives in CommandMenus and is its own concern; the
// point of this test is the *mode-independent* wrapper onContextMenu that identifies the clicked row.
// The mock just renders the children inside a span and we assert the right-click bubbles through it.
vi.mock('@renderer/components/command', () => ({
  CommandContextMenu: ({ children, ...props }: { children: ReactNode; getExtraItems?: () => unknown }) => {
    commandMenuMocks.props.push(props)
    return <span data-testid="command-context-menu">{children}</span>
  }
}))

vi.mock('../../resourceList/base', () => ({
  useResourceListActions: () => ({ openContextMenu }),
  useResourceListItemAccessors: () => ({ getItemId: (item: { id: string }) => item.id })
}))

vi.mock('../actionMenuItems', () => ({
  actionsToCommandMenuExtraItems: actionMenuItemMocks.actionsToCommandMenuExtraItems
}))

describe('ResourceListActionContextMenu', () => {
  it('sets the active item on the right-click itself, independent of the presentation mode', () => {
    openContextMenu.mockClear()
    commandMenuMocks.props = []

    render(
      <ResourceListActionContextMenu actions={[]} item={{ id: 'topic-7', name: 'Topic 7' }} onAction={vi.fn()}>
        <button type="button">Row</button>
      </ResourceListActionContextMenu>
    )

    // The wrapper onContextMenu fires on the right-click for both modes and carries the row identity.
    fireEvent.contextMenu(screen.getByText('Row'))

    expect(openContextMenu).toHaveBeenCalledWith('topic-7')
  })

  it('passes lazy action resolution to the command context menu', () => {
    commandMenuMocks.props = []
    actionMenuItemMocks.actionsToCommandMenuExtraItems.mockClear()
    const getActions = vi.fn(() => [])

    render(
      <ResourceListActionContextMenu
        getActions={getActions}
        item={{ id: 'topic-7', name: 'Topic 7' }}
        onAction={vi.fn()}>
        <button type="button">Row</button>
      </ResourceListActionContextMenu>
    )

    expect(actionMenuItemMocks.actionsToCommandMenuExtraItems).toHaveBeenCalledTimes(1)
    expect(getActions).not.toHaveBeenCalled()
    commandMenuMocks.props.at(-1)?.getExtraItems?.()
    expect(getActions).toHaveBeenCalledTimes(1)
  })
})
