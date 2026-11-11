import { t } from 'i18next'
import { describe, expect, it } from 'vitest'

import {
  executeWorkdirGroupAction,
  resolveWorkdirGroupActions,
  type WorkdirGroupActionContext
} from '../workdirGroupActions'

describe('workspace pin menu action', () => {
  it('toggles the selected workspace and blocks changes while pins are loading', async () => {
    const pinnedGroups = new Set<string>()
    const context: WorkdirGroupActionContext = {
      canDelete: true,
      canRename: true,
      canPin: true,
      pinned: false,
      group: { id: 'workspace-a', label: 'Project A' },
      workdirPath: '/project-a',
      onDelete: () => {},
      onOpen: () => {},
      onRename: () => {},
      onTogglePin: (group) => {
        if (pinnedGroups.has(group.id)) pinnedGroups.delete(group.id)
        else pinnedGroups.add(group.id)
      },
      t
    }
    const action = resolveWorkdirGroupActions(context).find((item) => item.id === 'workdir-group.toggle-pin')
    if (!action) throw new Error('Workspace menu is missing its pin action')

    await executeWorkdirGroupAction(action, context)
    expect([...pinnedGroups]).toEqual(['workspace-a'])
    await executeWorkdirGroupAction(action, { ...context, pinned: true, pinDisabled: true })
    expect([...pinnedGroups]).toEqual(['workspace-a'])
    await executeWorkdirGroupAction(action, { ...context, pinned: true })
    expect([...pinnedGroups]).toEqual([])
    expect(resolveWorkdirGroupActions({ ...context, canPin: false }).map((item) => item.id)).not.toContain(
      'workdir-group.toggle-pin'
    )
  })
})
