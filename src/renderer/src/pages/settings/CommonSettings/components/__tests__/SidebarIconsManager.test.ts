import { describe, expect, it } from 'vitest'

import { dragSidebarIcon, isAssistantSidebarIconMoveBlocked, moveSidebarIcon } from '../SidebarIconsManager'

describe('SidebarIconsManager helpers', () => {
  it('blocks hiding the assistants sidebar icon', () => {
    expect(isAssistantSidebarIconMoveBlocked('assistants', 'disabled')).toBe(true)
    expect(
      moveSidebarIcon('assistants', 'visible', {
        visibleIcons: ['assistants', 'agents'],
        invisibleIcons: ['store']
      })
    ).toBeNull()
    expect(
      dragSidebarIcon(
        { droppableId: 'visible', index: 0 },
        { droppableId: 'disabled', index: 0 },
        {
          visibleIcons: ['assistants', 'agents'],
          invisibleIcons: ['store']
        }
      )
    ).toBeNull()
  })

  it('moves non-assistant icons between visible and disabled lists', () => {
    expect(
      moveSidebarIcon('agents', 'visible', {
        visibleIcons: ['assistants', 'agents'],
        invisibleIcons: ['store']
      })
    ).toEqual({
      visibleIcons: ['assistants'],
      invisibleIcons: ['store', 'agents']
    })
  })

  it('reorders icons within the same list', () => {
    expect(
      dragSidebarIcon(
        { droppableId: 'visible', index: 2 },
        { droppableId: 'visible', index: 0 },
        {
          visibleIcons: ['assistants', 'agents', 'store'],
          invisibleIcons: []
        }
      )
    ).toEqual({
      visibleIcons: ['store', 'assistants', 'agents'],
      invisibleIcons: []
    })
  })
})
