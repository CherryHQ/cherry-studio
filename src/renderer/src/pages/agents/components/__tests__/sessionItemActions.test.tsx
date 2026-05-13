import { describe, expect, it, vi } from 'vitest'

import { executeSessionMenuAction, resolveSessionMenuActions, type SessionActionContext } from '../sessionItemActions'

const t = ((key: string) => key) as SessionActionContext['t']

function createSessionActionFixture(overrides: Partial<SessionActionContext> = {}): SessionActionContext {
  return {
    onDelete: vi.fn(),
    pinned: false,
    sessionName: 'Session title',
    setTopicPosition: vi.fn(),
    startEdit: vi.fn(),
    t,
    ...overrides
  }
}

describe('session item actions', () => {
  it('resolves rename, position, and delete actions without pin when pin callback is absent', () => {
    const actions = resolveSessionMenuActions(createSessionActionFixture())

    expect(actions.map((action) => action.id)).toEqual(['session.rename', 'session.position', 'session.delete'])
    expect(actions.find((action) => action.id === 'session.position')?.children.map((child) => child.id)).toEqual([
      'session.position-left',
      'session.position-right'
    ])
  })

  it('resolves pin label from pinned state and executes callbacks', async () => {
    const onTogglePin = vi.fn()
    const onDelete = vi.fn()
    const setTopicPosition = vi.fn()
    const startEdit = vi.fn()
    const actionContext = createSessionActionFixture({
      onDelete,
      onTogglePin,
      pinned: true,
      setTopicPosition,
      startEdit
    })
    const actions = resolveSessionMenuActions(actionContext)

    expect(actions.map((action) => action.id)).toEqual([
      'session.rename',
      'session.toggle-pin',
      'session.position',
      'session.delete'
    ])
    expect(actions.find((action) => action.id === 'session.toggle-pin')?.label).toBe('chat.topics.unpin')

    await executeSessionMenuAction(actions[0], actionContext)
    await executeSessionMenuAction(actions[1], actionContext)
    await executeSessionMenuAction(actions[2].children[0], actionContext)
    await executeSessionMenuAction(actions[3], actionContext)

    expect(startEdit).toHaveBeenCalledWith('Session title')
    expect(onTogglePin).toHaveBeenCalled()
    expect(setTopicPosition).toHaveBeenCalledWith('left')
    expect(onDelete).toHaveBeenCalled()
  })
})
