import { describe, expect, it, vi } from 'vitest'

import { executeSessionMenuAction, resolveSessionMenuActions, type SessionActionContext } from '../sessionItemActions'

const t = ((key: string) => key) as SessionActionContext['t']

function createSessionActionFixture(overrides: Partial<SessionActionContext> = {}): SessionActionContext {
  return {
    onDelete: vi.fn(),
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

    expect(actions.map((action) => action.id)).toEqual(['session.rename', 'session.delete'])
  })

  it('resolves pin label from pinned state and executes callbacks', async () => {
    const onTogglePin = vi.fn()
    const onDelete = vi.fn()
    const startEdit = vi.fn()
    const actionContext = createSessionActionFixture({
      onDelete,
      onTogglePin,
      pinned: true,
      startEdit
    })
    const actions = resolveSessionMenuActions(actionContext)
    const deleteAction = actions.find((action) => action.id === 'session.delete')

    expect(actions.map((action) => action.id)).toEqual(['session.rename', 'session.toggle-pin', 'session.delete'])
    expect(actions.find((action) => action.id === 'session.toggle-pin')?.label).toBe('chat.topics.unpin')
    expect(deleteAction?.confirm).toMatchObject({
      title: 'agent.session.delete.title',
      description: 'agent.session.delete.content',
      confirmText: 'common.delete',
      destructive: true
    })

    await executeSessionMenuAction(actions[0], actionContext)
    await executeSessionMenuAction(actions[1], actionContext)
    await executeSessionMenuAction(actions[2], actionContext)

    expect(startEdit).toHaveBeenCalledWith('Session title')
    expect(onTogglePin).toHaveBeenCalled()
    expect(onDelete).toHaveBeenCalled()
  })
})
