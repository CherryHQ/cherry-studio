import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'

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

import { openResourceEditDialog, ResourceEditDialogEventHost } from '../ResourceEditDialogEventHost'

describe('ResourceEditDialogEventHost', () => {
  afterEach(() => {
    EventEmitter.clearListeners()
  })

  it('delegates management without opening a local editor when the window supplies a destination', async () => {
    const onOpen = vi.fn()
    render(<ResourceEditDialogEventHost onOpen={onOpen} />)
    const target = { kind: 'assistant' as const, id: 'assistant-1', initialTab: 'prompts' }
    await act(async () => {
      openResourceEditDialog(target)
    })
    expect(onOpen).toHaveBeenCalledWith(target)
    expect(screen.queryByTestId('resource-edit-dialog-host')).not.toBeInTheDocument()
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
