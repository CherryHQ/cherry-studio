import { describe, expect, it, vi } from 'vitest'

import { executeSessionMenuAction, resolveSessionMenuActions, type SessionActionContext } from '../sessionItemActions'

const t = ((key: string) => key) as SessionActionContext['t']

function createSessionActionFixture(overrides: Partial<SessionActionContext> = {}): SessionActionContext {
  return {
    isActiveInCurrentTab: false,
    onDelete: vi.fn(),
    onSetPanePosition: vi.fn(),
    panePosition: 'left',
    pinned: false,
    sessionName: 'Session title',
    startEdit: vi.fn(),
    t,
    ...overrides
  }
}

describe('session item actions', () => {
  it('resolves rename and delete actions without pin when pin callback is absent', () => {
    const actions = resolveSessionMenuActions(createSessionActionFixture())

    expect(actions.map((action) => action.id)).toEqual(['session.rename', 'session.position', 'session.delete'])
  })

  it('resolves pin label from pinned state and executes callbacks without agent editing', async () => {
    const onTogglePin = vi.fn()
    const startEdit = vi.fn()
    const actionContext = createSessionActionFixture({
      onTogglePin,
      pinned: true,
      startEdit
    })
    const actions = resolveSessionMenuActions(actionContext)

    expect(actions.map((action) => action.id)).toEqual(['session.rename', 'session.toggle-pin', 'session.position'])
    expect(actions.find((action) => action.id === 'session.toggle-pin')?.label).toBe('agent.session.unpin.title')

    await executeSessionMenuAction(actions[0], actionContext)
    await executeSessionMenuAction(actions[1], actionContext)

    expect(startEdit).toHaveBeenCalledWith('Session title')
    expect(onTogglePin).toHaveBeenCalled()
  })

  it('hides open-in-new-tab when the session is already active in the current tab', () => {
    const actions = resolveSessionMenuActions(
      createSessionActionFixture({
        isActiveInCurrentTab: true,
        onOpenInNewTab: vi.fn()
      })
    )

    expect(actions.map((action) => action.id)).toEqual(['session.rename', 'session.position', 'session.delete'])
  })

  it('keeps open-in-new-window available even when the session is active in the current tab', async () => {
    const onOpenInNewWindow = vi.fn()
    const actionContext = createSessionActionFixture({
      isActiveInCurrentTab: true,
      onOpenInNewWindow
    })
    const actions = resolveSessionMenuActions(actionContext)

    expect(actions.map((action) => action.id)).toEqual([
      'session.rename',
      'session.open-in-new-window',
      'session.position',
      'session.delete'
    ])

    const action = actions.find((candidate) => candidate.id === 'session.open-in-new-window')
    await executeSessionMenuAction(action as (typeof actions)[number], actionContext)
    expect(onOpenInNewWindow).toHaveBeenCalled()
  })

  it('sets the pane position from the position submenu', async () => {
    const onSetPanePosition = vi.fn()
    const actionContext = createSessionActionFixture({ onSetPanePosition })
    const actions = resolveSessionMenuActions(actionContext)
    const positionAction = actions.find((action) => action.id === 'session.position')
    const rightAction = positionAction?.children.find((action) => action.id === 'session.position-right')

    expect(positionAction?.label).toBe('settings.topic.position.label')
    expect(rightAction?.availability.enabled).toBe(true)

    await executeSessionMenuAction(rightAction as (typeof actions)[number], actionContext)

    expect(onSetPanePosition).toHaveBeenCalledWith('right')
  })

  it('sets the pane position back to left from the right pane state', async () => {
    const onSetPanePosition = vi.fn()
    const actionContext = createSessionActionFixture({ onSetPanePosition, panePosition: 'right' })
    const actions = resolveSessionMenuActions(actionContext)
    const positionAction = actions.find((action) => action.id === 'session.position')
    const leftAction = positionAction?.children.find((action) => action.id === 'session.position-left')

    expect(leftAction?.availability.enabled).toBe(true)

    await executeSessionMenuAction(leftAction as (typeof actions)[number], actionContext)

    expect(onSetPanePosition).toHaveBeenCalledWith('left')
  })

  it('uses localized cancel text for the delete confirmation', () => {
    const actions = resolveSessionMenuActions(createSessionActionFixture())
    const deleteAction = actions.find((action) => action.id === 'session.delete')

    expect(deleteAction?.confirm?.cancelText).toBe('common.cancel')
  })
})
