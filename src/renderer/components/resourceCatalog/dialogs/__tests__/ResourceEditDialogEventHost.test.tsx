import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadEditModule: vi.fn()
}))

vi.mock('../edit', () => {
  mocks.loadEditModule()

  return {
    ResourceEditDialogHost: ({ target }: { target: { kind: string; id: string } }) => (
      <div data-testid="resource-edit-dialog-host" data-kind={target.kind} data-id={target.id} />
    )
  }
})

import { ResourceEditDialogEventHost } from '../ResourceEditDialogEventHost'

describe('ResourceEditDialogEventHost', () => {
  afterEach(() => {
    EventEmitter.clearListeners()
  })

  it('loads the edit dialog only after an open request', async () => {
    render(<ResourceEditDialogEventHost />)

    expect(mocks.loadEditModule).not.toHaveBeenCalled()

    await act(async () => {
      await EventEmitter.emit(EVENT_NAMES.OPEN_RESOURCE_EDIT_DIALOG, { kind: 'agent', id: 'agent-1' })
    })

    expect(await screen.findByTestId('resource-edit-dialog-host')).toHaveAttribute('data-id', 'agent-1')
    expect(mocks.loadEditModule).toHaveBeenCalledTimes(1)
  })
})
